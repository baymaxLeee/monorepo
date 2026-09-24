"""Asset control-plane client and durable Claim relay."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Literal

import httpx
from bootstrap.config import Settings, get_settings
from infrastructure.persistence.database import get_session_factory, write_tx
from infrastructure.persistence.models.asset_claim_intent import AssetClaimIntentRow
from kernel.tracing import propagation_headers
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("knowledge.asset")


class AssetRevision(BaseModel):
    asset_id: str
    revision_id: str
    category: str
    filename: str
    media_type: str
    size_bytes: int
    sha256: str
    created_by: str


class AssetClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._http = httpx.AsyncClient(
            base_url=self._settings.asset_service_url.rstrip("/"),
            timeout=httpx.Timeout(30.0, connect=2.0),
            headers={
                "X-Internal-Token": self._settings.internal_api_token,
                "X-Caller-Service": "knowledge",
            },
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def describe(self, *, tenant_id: str, workspace_id: str, asset_id: str, revision_id: str) -> AssetRevision:
        response = await self._http.get(
            f"/internal/assets/{asset_id}/revisions/{revision_id}",
            params={"tenant_id": tenant_id, "workspace_id": workspace_id},
            headers=propagation_headers(),
        )
        response.raise_for_status()
        return AssetRevision.model_validate(response.json())

    async def read(
        self, *, tenant_id: str, workspace_id: str, asset_id: str, revision_id: str, max_bytes: int
    ) -> bytes:
        async with self._http.stream(
            "GET",
            f"/internal/assets/{asset_id}/revisions/{revision_id}/content",
            params={"tenant_id": tenant_id, "workspace_id": workspace_id},
            headers=propagation_headers(),
        ) as response:
            response.raise_for_status()
            declared = response.headers.get("content-length")
            if declared is not None and int(declared) > max_bytes:
                raise ValueError("asset exceeds consumer byte limit")
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise ValueError("asset exceeds consumer byte limit")
                chunks.append(chunk)
            return b"".join(chunks)

    async def open_stream(
        self, *, tenant_id: str, workspace_id: str, asset_id: str, revision_id: str
    ) -> tuple[AsyncIterator[bytes], httpx.Headers]:
        request = self._http.build_request(
            "GET",
            f"/internal/assets/{asset_id}/revisions/{revision_id}/content",
            params={"tenant_id": tenant_id, "workspace_id": workspace_id},
            headers=propagation_headers(),
        )
        response = await self._http.send(request, stream=True)
        try:
            response.raise_for_status()
        except Exception:
            await response.aclose()
            raise

        async def chunks() -> AsyncIterator[bytes]:
            try:
                async for chunk in response.aiter_bytes():
                    yield chunk
            finally:
                await response.aclose()

        return chunks(), response.headers

    async def deliver_claim(self, intent: AssetClaimIntentRow) -> None:
        common = {
            "tenant_id": intent.tenant_id,
            "workspace_id": intent.workspace_id,
            "owner_type": intent.owner_type,
            "owner_id": intent.owner_id,
            "slot": intent.slot,
            "generation": intent.generation,
        }
        if intent.desired_state == "released":
            response = await self._http.post(
                "/internal/claims:prepare",
                json={
                    **common,
                    "asset_id": intent.asset_id,
                    "revision_id": intent.revision_id,
                    "kind": intent.kind,
                },
                headers=propagation_headers(),
            )
            response.raise_for_status()
            response = await self._http.post("/internal/claims:release", json=common, headers=propagation_headers())
            response.raise_for_status()
            return
        response = await self._http.post(
            "/internal/claims:prepare",
            json={
                **common,
                "asset_id": intent.asset_id,
                "revision_id": intent.revision_id,
                "kind": intent.kind,
            },
            headers=propagation_headers(),
        )
        response.raise_for_status()
        response = await self._http.post("/internal/claims:activate", json=common, headers=propagation_headers())
        response.raise_for_status()


_client: AssetClient | None = None


def get_asset_client() -> AssetClient:
    global _client
    if _client is None:
        _client = AssetClient()
    return _client


async def close_asset_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def ensure_document_claim_active(
    session: AsyncSession, *, tenant_id: str, workspace_id: str, document_id: str, asset_id: str, revision_id: str
) -> None:
    now = datetime.now(UTC)
    await session.execute(
        insert(AssetClaimIntentRow)
        .values(
            owner_type="document", owner_id=document_id, slot="source", tenant_id=tenant_id,
            workspace_id=workspace_id, asset_id=asset_id, revision_id=revision_id, kind="strong",
            generation=1, desired_state="active", next_attempt_at=now, created_at=now, updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[
                AssetClaimIntentRow.tenant_id, AssetClaimIntentRow.workspace_id,
                AssetClaimIntentRow.owner_type, AssetClaimIntentRow.owner_id, AssetClaimIntentRow.slot,
            ],
            set_={
                "tenant_id": tenant_id, "workspace_id": workspace_id, "asset_id": asset_id,
                "revision_id": revision_id, "kind": "strong",
                "generation": AssetClaimIntentRow.generation + 1, "desired_state": "active",
                "delivered_at": None, "attempt_count": 0, "next_attempt_at": now, "lease_until": None,
                "state_version": AssetClaimIntentRow.state_version + 1,
                "last_error": None, "updated_at": now,
            },
        )
    )


async def ensure_staged_media_claim_active(
    session: AsyncSession, *, tenant_id: str, workspace_id: str, staged_id: str, asset_id: str, revision_id: str
) -> None:
    now = datetime.now(UTC)
    await session.execute(
        insert(AssetClaimIntentRow)
        .values(
            owner_type="staged_media", owner_id=staged_id, slot="source", tenant_id=tenant_id,
            workspace_id=workspace_id, asset_id=asset_id, revision_id=revision_id, kind="strong",
            generation=1, desired_state="active", next_attempt_at=now, created_at=now, updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=[
                AssetClaimIntentRow.tenant_id, AssetClaimIntentRow.workspace_id,
                AssetClaimIntentRow.owner_type, AssetClaimIntentRow.owner_id, AssetClaimIntentRow.slot,
            ]
        )
    )


async def mark_staged_media_claim_released(
    session: AsyncSession, *, tenant_id: str, workspace_id: str, staged_id: str
) -> None:
    await mark_asset_claims_released(
        session, tenant_id=tenant_id, workspace_id=workspace_id, owner_type="staged_media", owner_ids=[staged_id]
    )


async def mark_document_claim_released(
    session: AsyncSession, *, tenant_id: str, workspace_id: str, document_id: str
) -> None:
    await mark_asset_claims_released(
        session, tenant_id=tenant_id, workspace_id=workspace_id, owner_type="document", owner_ids=[document_id]
    )


async def mark_asset_claims_released(
    session: AsyncSession, *, tenant_id: str, workspace_id: str, owner_type: str, owner_ids: list[str],
    slot: str = "source"
) -> int:
    if not owner_ids:
        return 0
    now = datetime.now(UTC)
    result = await session.execute(
        update(AssetClaimIntentRow)
        .where(
            AssetClaimIntentRow.tenant_id == tenant_id,
            AssetClaimIntentRow.workspace_id == workspace_id,
            AssetClaimIntentRow.owner_type == owner_type,
            AssetClaimIntentRow.owner_id.in_(owner_ids),
            AssetClaimIntentRow.slot == slot,
        )
        .values(
            desired_state="released", delivered_at=None, next_attempt_at=now, lease_until=None,
            state_version=AssetClaimIntentRow.state_version + 1, attempt_count=0, last_error=None, updated_at=now,
        )
        .returning(AssetClaimIntentRow.owner_id)
    )
    return len(result.scalars().all())


async def dispatch_pending_asset_claims(*, limit: int = 100) -> int:
    now = datetime.now(UTC)
    lease_until = now + timedelta(seconds=30)
    factory = get_session_factory()
    async with factory() as session, write_tx(session):
        rows = list(
            (
                await session.scalars(
                    select(AssetClaimIntentRow)
                    .where(
                        AssetClaimIntentRow.delivered_at.is_(None),
                        AssetClaimIntentRow.next_attempt_at <= now,
                        (AssetClaimIntentRow.lease_until.is_(None)) | (AssetClaimIntentRow.lease_until <= now),
                    )
                    .order_by(
                        AssetClaimIntentRow.next_attempt_at, AssetClaimIntentRow.updated_at,
                        AssetClaimIntentRow.tenant_id, AssetClaimIntentRow.workspace_id, AssetClaimIntentRow.owner_id,
                    )
                    .with_for_update(skip_locked=True)
                    .limit(limit)
                )
            ).all()
        )
        for row in rows:
            row.lease_until = lease_until
            row.state_version += 1
        await session.flush()
    client = get_asset_client()

    async def deliver(row: AssetClaimIntentRow) -> tuple[AssetClaimIntentRow, Literal["ok", "error"], str | None]:
        try:
            await client.deliver_claim(row)
            return row, "ok", None
        except Exception as exc:
            logger.warning("asset claim delivery failed for %s:%s", row.owner_type, row.owner_id, exc_info=True)
            return row, "error", str(exc)[:500]

    results = await asyncio.gather(*(deliver(row) for row in rows))
    if results:
        async with factory() as session, write_tx(session):
            committed_at = datetime.now(UTC)
            for row, status, error in results:
                identity = (
                    AssetClaimIntentRow.tenant_id == row.tenant_id,
                    AssetClaimIntentRow.workspace_id == row.workspace_id,
                    AssetClaimIntentRow.owner_type == row.owner_type,
                    AssetClaimIntentRow.owner_id == row.owner_id,
                    AssetClaimIntentRow.slot == row.slot,
                    AssetClaimIntentRow.generation == row.generation,
                    AssetClaimIntentRow.desired_state == row.desired_state,
                    AssetClaimIntentRow.state_version == row.state_version,
                    AssetClaimIntentRow.lease_until > committed_at,
                )
                values = (
                    {
                        "delivered_at": committed_at, "lease_until": None,
                        "state_version": row.state_version + 1, "last_error": None, "updated_at": committed_at,
                    }
                    if status == "ok"
                    else {
                        "attempt_count": AssetClaimIntentRow.attempt_count + 1,
                        "next_attempt_at": committed_at + timedelta(seconds=min(300, 2 ** min(row.attempt_count + 1, 8))),
                        "lease_until": None, "state_version": row.state_version + 1, "last_error": error,
                        "updated_at": committed_at,
                    }
                )
                await session.execute(update(AssetClaimIntentRow).where(*identity).values(**values))
    return sum(status == "ok" for _, status, _ in results)


async def run_asset_claim_relay(stop: asyncio.Event) -> None:
    interval = max(get_settings().asset_claim_dispatch_interval_seconds, 1.0)
    while not stop.is_set():
        try:
            await dispatch_pending_asset_claims()
        except Exception:
            logger.exception("asset claim relay failed; retrying")
        with suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)
