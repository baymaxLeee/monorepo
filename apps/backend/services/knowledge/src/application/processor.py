"""Background document conversion (single-process demo implementation).

Ingest returns as soon as bytes are received + stored (``received``); the heavy
MarkItDown/vision ``convert`` runs here, detached from the upload request, so a
large file no longer blocks the user from asking about it. Once conversion
writes ``content_md`` and flips the row to ``ready``, this schedules the
downstream RAG indexer.

Mirrors ``indexer.py``'s reliability shape (advisory-lock single-flight,
``_pending`` dirty re-run, startup sweep) but stays a separate module: convert
turns raw object bytes into ``content_md``; indexer turns ``content_md`` into
chunks. It is deliberately NOT durable — tasks live in-process and are lost on
crash/deploy; ``sweep_process`` re-queues survivors at startup.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging

from bootstrap.config import get_settings
from infrastructure.persistence.database import get_engine, get_session_factory, write_tx
from infrastructure.persistence.models.document import DocumentRow
from infrastructure.persistence.repositories import documents as document_crud
from kernel.errors import BaseError
from sqlalchemy import select, text, update

from application.admin_client import get_admin_client
from application.convert import ConvertService
from application.indexer import schedule_index
from application.object_store import ObjectStore

logger = logging.getLogger("knowledge.processor")

_tasks: set[asyncio.Task[None]] = set()
# doc_id -> "dirty": a (re)convert arrived while this doc was already running, so
# a fresh run must follow. Never drops a schedule, never leaves a doc stuck.
_pending: dict[str, bool] = {}
# doc_id -> request-scoped provider_id (vision captioning). Lost on restart; the
# startup sweep re-runs with None and the processor falls back to the org default.
_provider_ids: dict[str, str | None] = {}
_semaphore: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(get_settings().ingest_max_parallel)
    return _semaphore


def _lock_key(document_id: str) -> int:
    """Signed 64-bit advisory-lock key, namespaced apart from the indexer's so a
    doc's convert and index locks never collide."""
    digest = hashlib.blake2b(f"convert:{document_id}".encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


def schedule_process(document_id: str, *, provider_id: str | None = None) -> None:
    """Fire-and-forget background convert. If the doc is already running, mark it
    dirty so the current task re-runs on finish; the advisory lock dedups across
    the whole cluster."""
    _provider_ids[document_id] = provider_id
    if document_id in _pending:
        _pending[document_id] = True
        return
    _pending[document_id] = False
    task = asyncio.create_task(_run(document_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _run(document_id: str) -> None:
    try:
        async with _get_semaphore():
            await _convert_with_lock(document_id)
    except Exception as exc:  # a background task must never escape unhandled
        logger.warning("background convert failed for %s: %s", document_id, exc)
        await _mark_failed(document_id, str(exc))
    finally:
        dirty = _pending.pop(document_id, False)
        if dirty:
            schedule_process(document_id, provider_id=_provider_ids.get(document_id))
        else:
            _provider_ids.pop(document_id, None)


async def _convert_with_lock(document_id: str) -> None:
    key = _lock_key(document_id)
    async with get_engine().connect() as lock_conn:
        locked = (await lock_conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key})).scalar()
        await lock_conn.commit()
        if not locked:
            # Another replica owns this document's convert; safe to drop.
            return
        try:
            await _convert_once(document_id)
        finally:
            await lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
            await lock_conn.commit()


async def _convert_once(document_id: str) -> None:
    factory = get_session_factory()
    cached_markdown: str | None = None
    # Reads + the "converting" write must live inside one write_tx: write_tx
    # rejects a session that already has an autobegun transaction, so the row
    # fetch and cache lookup cannot run before it.
    async with factory() as session, write_tx(session):
        row = await document_crud.get_document_by_id(session, document_id)
        if row is None or row.kind != "source":
            return
        if row.ingest_status == "ready" and row.content_md:
            return
        if not row.object_bucket or not row.object_key:
            await document_crud.update_document(
                session,
                row,
                {"ingest_status": "failed", "ingest_error": "document has no stored source object"},
            )
            return
        provider_id = _provider_ids.get(document_id)
        source_mime = row.source_mime_type or row.mime_type
        source_filename = row.source_filename or row.filename
        org_id = row.org_id
        user_id = row.user_id
        object_sha256 = row.object_sha256
        object_bucket = row.object_bucket
        object_key = row.object_key

        # Vision captions depend on the provider/model, so only reuse cached
        # conversions for deterministic (non-media) MarkItDown output.
        is_media = source_mime.lower().startswith(("image/", "audio/", "video/"))
        if not is_media and object_sha256:
            cached_markdown = await document_crud.find_converted_cache(
                session,
                object_sha256=object_sha256,
                org_id=org_id,
                user_id=user_id,
                exclude_document_id=document_id,
            )

        await document_crud.update_document(session, row, {"ingest_status": "converting"})

    if cached_markdown is not None:
        markdown = cached_markdown
    else:
        content = ObjectStore().get_bytes(bucket=object_bucket, key=object_key)
        provider = await _resolve_provider(source_mime, org_id=org_id, provider_id=provider_id)
        settings = get_settings()
        convert_timeout = max(settings.llm_timeout_seconds * 2, 90)
        markdown = await asyncio.wait_for(
            ConvertService().convert(
                filename=source_filename,
                mime_type=source_mime,
                content=content,
                provider=provider,
            ),
            timeout=convert_timeout,
        )

    async with factory() as session, write_tx(session):
        fresh = await document_crud.get_document_by_id(session, document_id)
        if fresh is None:
            return
        await document_crud.update_document(
            session,
            fresh,
            {
                "content_md": markdown,
                "mime_type": "text/markdown",
                "ingest_status": "ready",
                "ingest_progress": 100,
                "ingest_error": None,
                "index_status": "pending",
            },
        )
    schedule_index(document_id)


async def _resolve_provider(mime_type: str, *, org_id: str | None, provider_id: str | None):  # type: ignore[no-untyped-def]
    """Vision captioning needs a provider only for image/audio/video. Resolve the
    request-scoped provider_id when present, else the org default; failures fall
    back to ``None`` so convert still produces metadata markdown."""
    if not mime_type.lower().startswith(("image/", "audio/", "video/")):
        return None
    try:
        return await get_admin_client().get_provider(org_id=org_id or "", provider_id=provider_id)
    except BaseError:
        return None


async def _mark_failed(document_id: str, message: str) -> None:
    try:
        factory = get_session_factory()
        async with factory() as session, write_tx(session):
            row = await document_crud.get_document_by_id(session, document_id)
            if row is None:
                return
            # Keep the stored object: read_file / manual retry need the source.
            await document_crud.update_document(
                session,
                row,
                {"ingest_status": "failed", "ingest_error": message[:500]},
            )
    except Exception:  # best-effort status write
        logger.exception("failed to mark convert failure for %s", document_id)


async def sweep_process() -> int:
    """Startup recovery: reset rows stuck in ``converting`` back to ``received``,
    then queue every ``received`` document. The advisory lock makes this safe even
    if several replicas sweep at once. Request-scoped provider_id is gone after a
    restart, so convert falls back to the org default provider."""
    factory = get_session_factory()
    async with factory() as session:
        async with write_tx(session):
            await session.execute(
                update(DocumentRow).where(DocumentRow.ingest_status == "converting").values(ingest_status="received")
            )
        rows = await session.execute(select(DocumentRow.id).where(DocumentRow.ingest_status == "received"))
        ids = [row_id for (row_id,) in rows.all()]
    for document_id in ids:
        schedule_process(document_id)
    return len(ids)
