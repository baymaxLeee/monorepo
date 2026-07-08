"""Parallel document ingest."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from kernel.errors import BaseError
from knowledge.config import get_settings
from knowledge.crud import documents as document_crud
from knowledge.db import get_session_factory, write_tx
from knowledge.deps import AuthContext
from knowledge.models.document import DocumentRow
from knowledge.schemas.document import IngestFailure, IngestReceipt, IngestResult
from knowledge.services.convert import AttachmentTooLargeError
from knowledge.services.documents import document_to_schema
from knowledge.services.object_store import ObjectStore
from knowledge.services.processor import schedule_process


@dataclass(frozen=True)
class IngestFileItem:
    index: int
    client_ref: str
    filename: str
    mime_type: str
    content: bytes


async def ingest_documents(
    *,
    current_user: AuthContext,
    conversation_id: str | None,
    provider_id: str | None,
    items: list[IngestFileItem],
) -> IngestResult:
    settings = get_settings()
    factory = get_session_factory()

    async def ingest_one(item: IngestFileItem, semaphore: asyncio.Semaphore) -> IngestReceipt | IngestFailure:
        async with semaphore:
            store = ObjectStore()
            row: DocumentRow | None = None
            stored_bucket: str | None = None
            stored_key: str | None = None
            async with factory() as worker_session:
                try:
                    if len(item.content) > settings.attachment_max_upload_bytes:
                        raise AttachmentTooLargeError(
                            "attachment too large",
                            details={"max_bytes": settings.attachment_max_upload_bytes},
                        )

                    async with write_tx(worker_session):
                        row = await document_crud.create_document(
                            worker_session,
                            user_id=current_user.user_id,
                            org_id=current_user.org_id,
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
                    async with write_tx(worker_session):
                        row = await document_crud.update_document(
                            worker_session,
                            row,
                            {
                                "object_bucket": stored.bucket,
                                "object_key": stored.key,
                                "object_sha256": stored.sha256,
                                "ingest_status": "received",
                                "ingest_progress": 100,
                            },
                        )
                    doc = document_to_schema(row)
                    schedule_process(row.id, provider_id=provider_id)
                    return IngestReceipt(index=item.index, client_ref=item.client_ref, document=doc)
                except Exception as exc:
                    code = exc.code if isinstance(exc, BaseError) else None
                    message = str(exc)
                    if row is not None:
                        async with write_tx(worker_session):
                            row = await document_crud.update_document(
                                worker_session,
                                row,
                                {
                                    "ingest_status": "failed",
                                    "ingest_progress": 0,
                                    "ingest_error": message[:500],
                                },
                            )
                    if stored_bucket and stored_key:
                        with suppress(Exception):
                            store.delete(bucket=stored_bucket, key=stored_key)
                    return IngestFailure(
                        index=item.index,
                        client_ref=item.client_ref,
                        artifact_id=row.id if row is not None else None,
                        error=message,
                        code=code,
                    )

    semaphore = asyncio.Semaphore(settings.ingest_max_parallel)
    results = await asyncio.gather(*(ingest_one(item, semaphore) for item in items))
    return IngestResult(
        documents=[result for result in results if isinstance(result, IngestReceipt)],
        failed=[result for result in results if isinstance(result, IngestFailure)],
    )


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
