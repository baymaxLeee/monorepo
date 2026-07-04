"""Parallel document ingest with SSE progress."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi.responses import StreamingResponse
from kernel.errors import BaseError
from knowledge.config import get_settings
from knowledge.crud import documents as document_crud
from knowledge.db import get_session_factory
from knowledge.deps import AuthContext
from knowledge.models.document import DocumentRow
from knowledge.services.admin_client import get_admin_client
from knowledge.services.convert import AttachmentConversionError, AttachmentTooLargeError, ConvertService
from knowledge.services.documents import document_to_schema
from knowledge.services.indexing import index_document
from knowledge.services.object_store import ObjectStore
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class IngestFileItem:
    index: int
    client_ref: str
    filename: str
    mime_type: str
    content: bytes


_SENTINEL = object()


def sse_response(event_stream: AsyncIterator[bytes]) -> StreamingResponse:
    from fastapi.responses import StreamingResponse

    return StreamingResponse(
        event_stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def stream_ingest_events(
    *,
    session: AsyncSession,
    current_user: AuthContext,
    conversation_id: str | None,
    provider_id: str | None,
    items: list[IngestFileItem],
) -> AsyncIterator[bytes]:
    settings = get_settings()
    queue: asyncio.Queue[dict[str, Any] | object] = asyncio.Queue()
    succeeded = 0
    failed = 0
    factory = get_session_factory()

    async def emit(event: dict[str, Any]) -> None:
        await queue.put(event)

    async def ingest_one(item: IngestFileItem, semaphore: asyncio.Semaphore) -> None:
        nonlocal succeeded, failed
        async with semaphore:
            store = ObjectStore()
            converter = ConvertService()
            row: DocumentRow | None = None
            stored_bucket: str | None = None
            stored_key: str | None = None
            async with factory() as worker_session:
                try:
                    await emit(
                        {
                            "type": "file_started",
                            "index": item.index,
                            "client_ref": item.client_ref,
                            "filename": item.filename,
                        }
                    )
                    if len(item.content) > settings.attachment_max_upload_bytes:
                        raise AttachmentTooLargeError(
                            "attachment too large",
                            details={"max_bytes": settings.attachment_max_upload_bytes},
                        )

                    row = await document_crud.create_document(
                        worker_session,
                        user_id=current_user.user_id,
                        conversation_id=conversation_id,
                        kind="source",
                        title=item.filename,
                        filename=item.filename,
                        mime_type="text/markdown",
                        source_size=len(item.content),
                        source_mime_type=item.mime_type,
                        source_filename=item.filename,
                        ingest_status="storing",
                        ingest_progress=10,
                    )
                    await worker_session.commit()
                    await emit(
                        {
                            "type": "file_progress",
                            "index": item.index,
                            "client_ref": item.client_ref,
                            "artifact_id": row.id,
                            "status": "storing",
                            "progress": 10,
                        }
                    )

                    prefix = f"conversations/{conversation_id}" if conversation_id else "uploads"
                    stored = store.put_bytes(
                        content=item.content,
                        filename=item.filename,
                        mime_type=item.mime_type,
                        user_id=current_user.user_id,
                        prefix=prefix,
                    )
                    stored_bucket = stored.bucket
                    stored_key = stored.key
                    row = await document_crud.update_document(
                        worker_session,
                        row,
                        {
                            "object_bucket": stored.bucket,
                            "object_key": stored.key,
                            "object_sha256": stored.sha256,
                            "ingest_status": "converting",
                            "ingest_progress": 50,
                        },
                    )
                    await worker_session.commit()
                    await emit(
                        {
                            "type": "file_progress",
                            "index": item.index,
                            "client_ref": item.client_ref,
                            "artifact_id": row.id,
                            "status": "converting",
                            "progress": 50,
                        }
                    )

                    provider = None
                    if item.mime_type.lower().startswith(("image/", "audio/", "video/")) and provider_id:
                        provider = await get_admin_client().get_provider(
                            user_id=current_user.user_id,
                            provider_id=provider_id,
                        )
                    convert_timeout = max(settings.llm_timeout_seconds * 2, 90)
                    try:
                        markdown = await asyncio.wait_for(
                            converter.convert(
                                filename=item.filename,
                                mime_type=item.mime_type,
                                content=item.content,
                                provider=provider,
                            ),
                            timeout=convert_timeout,
                        )
                    except TimeoutError as exc:
                        raise AttachmentConversionError(
                            f"conversion timed out after {convert_timeout}s",
                            details={"filename": item.filename},
                        ) from exc
                    row = await document_crud.update_document(
                        worker_session,
                        row,
                        {
                            "content_md": markdown,
                            "mime_type": "text/markdown",
                            "ingest_status": "ready",
                            "ingest_progress": 100,
                            "ingest_error": None,
                        },
                    )
                    await worker_session.commit()
                    try:
                        index_result = await index_document(
                            worker_session, document_id=row.id, user_id=current_user.user_id
                        )
                        if index_result.note:
                            print(f"[knowledge-ingest] index note for {row.id}: {index_result.note}")
                    except Exception as index_exc:
                        print(f"[knowledge-ingest] indexing failed for {row.id}: {index_exc}")
                    succeeded += 1
                    doc = document_to_schema(row)
                    await emit(
                        {
                            "type": "file_ready",
                            "index": item.index,
                            "client_ref": item.client_ref,
                            "artifact_id": row.id,
                            "progress": 100,
                            "document": doc.model_dump(mode="json"),
                        }
                    )
                except Exception as exc:
                    await worker_session.rollback()
                    failed += 1
                    code = exc.code if isinstance(exc, BaseError) else None
                    message = str(exc)
                    if row is not None:
                        row = await document_crud.update_document(
                            worker_session,
                            row,
                            {
                                "ingest_status": "failed",
                                "ingest_progress": 0,
                                "ingest_error": message[:500],
                            },
                        )
                        await worker_session.commit()
                    if stored_bucket and stored_key:
                        with suppress(Exception):
                            store.delete(bucket=stored_bucket, key=stored_key)
                    await emit(
                        {
                            "type": "file_failed",
                            "index": item.index,
                            "client_ref": item.client_ref,
                            "artifact_id": row.id if row is not None else None,
                            "error": message,
                            "code": code,
                        }
                    )

    async def run_batch() -> None:
        await emit({"type": "batch_started", "total": len(items), "max_parallel": settings.ingest_max_parallel})
        semaphore = asyncio.Semaphore(settings.ingest_max_parallel)
        await asyncio.gather(*(ingest_one(item, semaphore) for item in items))
        await emit({"type": "batch_done", "succeeded": succeeded, "failed": failed})
        await queue.put(_SENTINEL)

    task = asyncio.create_task(run_batch())
    try:
        while True:
            event = await queue.get()
            if event is _SENTINEL:
                break
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode()
            await asyncio.sleep(0)
    finally:
        await task
    yield b"data: [DONE]\n\n"


def parse_ingest_items(
    *,
    files: list[tuple[str, bytes, str]],
    client_refs: list[str],
) -> list[IngestFileItem]:
    if len(files) != len(client_refs):
        raise ValueError("files and client_refs length mismatch")
    items: list[IngestFileItem] = []
    for index, ((filename, content, mime_type), client_ref) in enumerate(zip(files, client_refs, strict=True)):
        safe_name = Path(filename or "attachment").name or "attachment"
        items.append(
            IngestFileItem(
                index=index,
                client_ref=client_ref,
                filename=safe_name,
                mime_type=mime_type or "application/octet-stream",
                content=content,
            )
        )
    return items
