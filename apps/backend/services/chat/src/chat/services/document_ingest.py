"""Parallel document ingest with SSE progress events."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from kernel.errors import BaseError
from sqlalchemy.ext.asyncio import AsyncSession

from chat.config import get_settings
from chat.crud import documents as document_crud
from chat.db import get_session_factory
from chat.deps import AuthContext
from chat.models.document import ConversationDocumentRow
from chat.services.attachments import AttachmentService, AttachmentTooLargeError
from chat.services.documents import ConversationDocumentService, document_to_schema
from chat.services.storage_client import StorageClient, StorageUnavailableError


@dataclass(frozen=True)
class IngestFileItem:
    index: int
    client_ref: str
    filename: str
    mime_type: str
    content: bytes


_SENTINEL = object()


def sse_response(event_stream: AsyncIterator[bytes]):
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
    conversation_id: str,
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
            attachments = AttachmentService()
            storage = StorageClient()
            row: ConversationDocumentRow | None = None
            stored_bucket: str | None = None
            stored_key: str | None = None
            async with factory() as worker_session:
                service = ConversationDocumentService(worker_session, current_user)
                try:
                    await emit(
                        {
                            "type": "file_started",
                            "index": item.index,
                            "client_ref": item.client_ref,
                            "filename": item.filename,
                        }
                    )
                    if len(item.content) > attachments.max_upload_bytes:
                        raise AttachmentTooLargeError(
                            "attachment exceeds the chat conversion demo limit",
                            details={
                                "max_bytes": attachments.max_upload_bytes,
                                "actual_bytes": len(item.content),
                            },
                        )

                    row = await document_crud.create_document(
                        worker_session,
                        conversation_id=conversation_id,
                        kind="source",
                        title=item.filename,
                        filename=item.filename,
                        mime_type="text/markdown",
                        content_md="",
                        source_size=len(item.content),
                        source_mime_type=item.mime_type,
                        source_filename=item.filename,
                        ingest_status="storing",
                        ingest_progress=0,
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

                    stored = await storage.put_bytes(
                        content=item.content,
                        filename=item.filename,
                        mime_type=item.mime_type,
                        user_id=current_user.user_id,
                        prefix=f"conversations/{conversation_id}",
                    )
                    stored_bucket = stored.bucket
                    stored_key = stored.key
                    row = await document_crud.update_document(
                        worker_session,
                        row,
                        {
                            "source_object_bucket": stored.bucket,
                            "source_object_key": stored.key,
                            "source_sha256": stored.sha256,
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
                            "status": "storing",
                            "progress": 50,
                        }
                    )

                    conversation = await service._get_conversation(conversation_id)
                    provider = (
                        None
                        if _is_image_mime(item.mime_type)
                        else await service._resolve_attachment_provider(conversation)
                    )
                    await emit(
                        {
                            "type": "file_progress",
                            "index": item.index,
                            "client_ref": item.client_ref,
                            "artifact_id": row.id,
                            "status": "converting",
                            "progress": 90,
                        }
                    )
                    converted = await attachments.convert(
                        filename=item.filename,
                        mime_type=item.mime_type,
                        content=item.content,
                        provider=provider,
                    )
                    row = await document_crud.update_document(
                        worker_session,
                        row,
                        {
                            "content_md": converted.markdown,
                            "mime_type": "text/markdown",
                            "ingest_status": "ready",
                            "ingest_progress": 100,
                            "ingest_error": None,
                        },
                    )
                    await worker_session.commit()
                    succeeded += 1
                    await emit(
                        {
                            "type": "file_ready",
                            "index": item.index,
                            "client_ref": item.client_ref,
                            "artifact_id": row.id,
                            "progress": 100,
                            "document": document_to_schema(row).model_dump(mode="json"),
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
                        with suppress(StorageUnavailableError):
                            await storage.delete(bucket=stored_bucket, key=stored_key)
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
        await emit(
            {
                "type": "batch_started",
                "total": len(items),
                "max_parallel": settings.ingest_max_parallel,
            }
        )
        semaphore = asyncio.Semaphore(settings.ingest_max_parallel)
        await asyncio.gather(*(ingest_one(item, semaphore) for item in items))
        await emit(
            {
                "type": "batch_done",
                "succeeded": succeeded,
                "failed": failed,
            }
        )
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


def _is_image_mime(mime_type: str) -> bool:
    return mime_type.lower().startswith("image/")
