"""Idempotent document indexing invoked by Executor's durable Workflow."""

from __future__ import annotations

import hashlib
import logging

from infrastructure.persistence.database import get_engine, get_session_factory, write_tx
from infrastructure.persistence.models.document import DocumentRow
from infrastructure.persistence.repositories import chunks as chunk_crud
from infrastructure.persistence.repositories import documents as document_crud
from sqlalchemy import select, text

from application.indexing import index_document

logger = logging.getLogger("knowledge.indexer")


def _lock_key(document_id: str) -> int:
    digest = hashlib.blake2b(f"index:{document_id}".encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


async def index_document_by_id(document_id: str) -> str:
    """Replace one document's searchable chunks under a cluster-wide lock.

    The lock blocks instead of opportunistically dropping duplicate work. Executor
    may replay or concurrently dispatch a newer document version; every accepted
    Workflow therefore reaches an authoritative state transition.
    """
    key = _lock_key(document_id)
    async with get_engine().connect() as lock_conn:
        await lock_conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": key})
        await lock_conn.commit()
        try:
            return await _index_once(document_id)
        finally:
            await lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
            await lock_conn.commit()


async def _index_once(document_id: str) -> str:
    factory = get_session_factory()
    async with factory() as session:
        async with write_tx(session):
            row = await document_crud.get_document_by_id(session, document_id)
            if row is None:
                return "deleted"
            if row.kind != "source" or row.ingest_status != "ready":
                return "not-ready"
            if row.index_status == "indexed":
                return "already-indexed"
            captured_updated_at = row.updated_at
            await document_crud.set_index_status(session, document_id, status="indexing")

        try:
            result, new_rows = await index_document(row)
        except Exception as exc:
            await _mark_failed(document_id, str(exc), expected_updated_at=captured_updated_at)
            raise

        async with write_tx(session):
            fresh = await session.scalar(select(DocumentRow).where(DocumentRow.id == document_id).with_for_update())
            if fresh is None:
                return "deleted"
            if fresh.updated_at != captured_updated_at:
                await document_crud.set_index_status(session, document_id, status="pending")
                logger.info("index result for %s superseded by a newer edit", document_id)
                return "superseded"
            await chunk_crud.delete_document_chunks(session, document_id)
            await chunk_crud.insert_chunks(session, new_rows)
            error = result.reason if result.status == "failed" else None
            await document_crud.set_index_status(
                session, document_id, status=result.status, error=error[:500] if error else None
            )
            return result.status


async def _mark_failed(document_id: str, message: str, *, expected_updated_at) -> None:
    try:
        factory = get_session_factory()
        async with factory() as session, write_tx(session):
            row = await document_crud.get_document_by_id(session, document_id)
            if row is not None and row.updated_at == expected_updated_at:
                await document_crud.set_index_status(session, document_id, status="failed", error=message[:500])
    except Exception:
        logger.exception("failed to mark index failure for %s", document_id)
