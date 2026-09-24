"""Durable document-task dispatch to the executor service."""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from datetime import UTC, datetime, timedelta

import httpx
from bootstrap.config import Settings, get_settings
from infrastructure.persistence.database import get_session_factory, write_tx
from infrastructure.persistence.models.document import DocumentRow
from kernel.tracing import propagation_headers
from sqlalchemy import or_, select, update

logger = logging.getLogger("knowledge.executor")


class ExecutorClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._http = httpx.AsyncClient(
            base_url=self._settings.executor_service_url.rstrip("/"),
            timeout=httpx.Timeout(5.0, connect=2.0),
            headers={
                "X-Internal-Token": self._settings.internal_api_token,
                "X-Caller-Service": "knowledge",
            },
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def dispatch_document(
        self,
        document_id: str,
        *,
        updated_at: datetime,
        provider_id: str | None = None,
    ) -> None:
        revision = updated_at.isoformat()
        response = await self._http.post(
            "/tasks",
            headers=propagation_headers(),
            json={
                "type": "knowledge-document-process",
                "owner_service": "knowledge",
                "owner_ref": f"document:{document_id}:{revision}",
                "payload": {
                    "documentId": document_id,
                    **({"providerId": provider_id} if provider_id else {}),
                },
            },
        )
        response.raise_for_status()


_client: ExecutorClient | None = None


def get_executor_client() -> ExecutorClient:
    global _client
    if _client is None:
        _client = ExecutorClient()
    return _client


async def close_executor_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def dispatch_pending_documents(*, limit: int = 100) -> int:
    """Submit a bounded batch. Executor's owner key deduplicates replicas."""
    settings = get_settings()
    retry_before = datetime.now(UTC) - timedelta(seconds=settings.executor_redispatch_after_seconds)
    factory = get_session_factory()
    async with factory() as session:
        rows = list(
            (
                await session.scalars(
                    select(DocumentRow)
                    .where(
                        DocumentRow.kind == "source",
                        or_(
                            DocumentRow.ingest_status.in_(("received", "converting")),
                            (DocumentRow.ingest_status == "ready")
                            & (DocumentRow.index_status.in_(("pending", "indexing"))),
                        ),
                        or_(
                            DocumentRow.processing_dispatched_at.is_(None),
                            DocumentRow.processing_dispatched_at <= retry_before,
                        ),
                    )
                    .order_by(
                        DocumentRow.processing_dispatched_at.asc().nulls_first(),
                        DocumentRow.updated_at,
                        DocumentRow.id,
                    )
                    .limit(limit)
                )
            ).all()
        )
    client = get_executor_client()
    semaphore = asyncio.Semaphore(settings.executor_dispatch_max_parallel)

    async def dispatch(row: DocumentRow) -> DocumentRow | None:
        async with semaphore:
            try:
                await client.dispatch_document(
                    row.id,
                    updated_at=row.updated_at,
                    provider_id=row.conversion_provider_id,
                )
            except Exception:
                logger.warning(
                    "document task dispatch failed for %s; scanner will retry",
                    row.id,
                    exc_info=True,
                )
                return None
            return row

    results = await asyncio.gather(*(dispatch(row) for row in rows))
    submitted = [row for row in results if row is not None]
    if submitted:
        async with factory() as session, write_tx(session):
            dispatched_at = datetime.now(UTC)
            for row in submitted:
                await session.execute(
                    update(DocumentRow)
                    .where(DocumentRow.id == row.id, DocumentRow.updated_at == row.updated_at)
                    .values(processing_dispatched_at=dispatched_at)
                )
    return len(submitted)


async def dispatch_document_now(
    document_id: str,
    *,
    updated_at: datetime,
    provider_id: str | None = None,
) -> None:
    """Best-effort low-latency dispatch; the DB scanner is the recovery path."""
    try:
        await get_executor_client().dispatch_document(
            document_id,
            updated_at=updated_at,
            provider_id=provider_id,
        )
        factory = get_session_factory()
        async with factory() as session, write_tx(session):
            await session.execute(
                update(DocumentRow)
                .where(DocumentRow.id == document_id, DocumentRow.updated_at == updated_at)
                .values(processing_dispatched_at=datetime.now(UTC))
            )
    except Exception:
        logger.warning("immediate document task dispatch failed for %s; scanner will retry", document_id)


async def run_document_dispatcher(stop: asyncio.Event) -> None:
    """Continuously bridge durable DB intent to Executor without per-row tasks."""
    interval = max(get_settings().executor_dispatch_interval_seconds, 1.0)
    while not stop.is_set():
        try:
            dispatched = await dispatch_pending_documents()
            if dispatched:
                logger.info("submitted %d document task(s) to executor", dispatched)
        except Exception:
            logger.exception("document task dispatch failed; retrying")
        with suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)
