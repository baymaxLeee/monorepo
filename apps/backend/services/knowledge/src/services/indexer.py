"""Background RAG indexing (single-process demo implementation).

Ingest/edit return as soon as a document is stored + converted (ready/100);
embedding + chunking run here, detached from the request, so import progress no
longer blocks on embeddings.

This is deliberately NOT a durable job system. Tasks live in-process and are lost
on crash/deploy; ``sweep_claim`` re-queues survivors at startup. If durable,
resumable, cross-replica execution is later required, move this to the executor
service's Workflow DevKit (see ADR-0019).

Per-document correctness under concurrent triggers (import / PATCH / reindex /
startup sweep) relies on two things:
- a Postgres advisory lock held for the whole operation -> single-flight across
  processes/replicas, so two runs never contend on the
  ``ux_document_chunks_doc_index`` unique constraint;
- a content-fingerprint re-run loop -> if ``content_md`` changes while we index,
  we re-run so the latest content wins instead of a stale snapshot.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging

from config import get_settings
from crud import chunks as chunk_crud
from crud import documents as document_crud
from db import get_engine, get_session_factory, write_tx
from models.document import DocumentRow
from sqlalchemy import select, text, update

from services.indexing import index_document

logger = logging.getLogger("knowledge.indexer")

_tasks: set[asyncio.Task[None]] = set()
# doc_id -> "dirty": a (re)index arrived while this doc was already running, so a
# fresh run must follow. This never drops a schedule and never leaves a doc stuck.
_pending: dict[str, bool] = {}
_semaphore: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(get_settings().index_max_parallel)
    return _semaphore


def _lock_key(document_id: str) -> int:
    """Deterministic signed 64-bit key for pg_try_advisory_lock(bigint)."""
    digest = hashlib.blake2b(document_id.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


def schedule_index(document_id: str) -> None:
    """Fire-and-forget background (re)index. If the doc is already running, mark it
    dirty so the current task re-runs on finish; the advisory lock dedups across
    the whole cluster."""
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
            await _index_with_lock(document_id)
    except Exception as exc:  # a background task must never escape unhandled
        logger.warning("background index failed for %s: %s", document_id, exc)
        await _mark_failed(document_id, str(exc))
    finally:
        # A schedule that arrived mid-run (edit / autosave) set dirty; run again so
        # the latest content is indexed and the doc never gets stuck.
        dirty = _pending.pop(document_id, False)
        if dirty:
            schedule_index(document_id)


async def _index_with_lock(document_id: str) -> None:
    key = _lock_key(document_id)
    async with get_engine().connect() as lock_conn:
        locked = (await lock_conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key})).scalar()
        await lock_conn.commit()
        if not locked:
            # Another replica owns this document; it indexes the latest content,
            # so dropping here is safe and avoids unique-constraint contention.
            return
        try:
            await _index_once(document_id)
        finally:
            await lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
            await lock_conn.commit()


async def _index_once(document_id: str) -> None:
    factory = get_session_factory()
    async with factory() as session:
        async with write_tx(session):
            row = await document_crud.get_document_by_id(session, document_id)
            if row is None:
                return
            captured_updated_at = row.updated_at  # content version guard for the final write
            await document_crud.set_index_status(session, document_id, status="indexing")

        result, new_rows = await index_document(row)

        async with write_tx(session):
            fresh = await session.scalar(select(DocumentRow).where(DocumentRow.id == document_id).with_for_update())
            if fresh is None or fresh.updated_at != captured_updated_at:
                wrote = False
            else:
                await chunk_crud.delete_document_chunks(session, document_id)
                await chunk_crud.insert_chunks(session, new_rows)
                wrote = True
            error = result.reason if result.status == "failed" else None
            if wrote:
                await document_crud.set_index_status(
                    session, document_id, status=result.status, error=error[:500] if error else None
                )
        if not wrote:
            # An edit landed while we indexed; the stale result is discarded. The
            # edit's schedule set us dirty, so _run re-indexes the new content.
            logger.info("index result for %s superseded by a newer edit; re-running", document_id)


async def _mark_failed(document_id: str, message: str) -> None:
    try:
        factory = get_session_factory()
        async with factory() as session, write_tx(session):
            await document_crud.set_index_status(session, document_id, status="failed", error=message[:500])
    except Exception:  # best-effort status write
        logger.exception("failed to mark index failure for %s", document_id)


async def sweep_claim() -> int:
    """Startup recovery: reset crashed 'indexing' rows to 'pending', then queue
    every 'pending' document. The advisory lock makes this safe even if several
    replicas sweep at once."""
    factory = get_session_factory()
    async with factory() as session:
        async with write_tx(session):
            await session.execute(
                update(DocumentRow).where(DocumentRow.index_status == "indexing").values(index_status="pending")
            )
        rows = await session.execute(select(DocumentRow.id).where(DocumentRow.index_status == "pending"))
        ids = [row_id for (row_id,) in rows.all()]
    for document_id in ids:
        schedule_index(document_id)
    return len(ids)
