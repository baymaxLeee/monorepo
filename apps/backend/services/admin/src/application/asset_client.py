"""Asset transport plus a lease-fenced durable Claim relay for Admin."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections.abc import AsyncIterator
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path
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

logger = logging.getLogger("admin.asset")


class AssetRevision(BaseModel):
    asset_id: str
    revision_id: str
    category: str
    filename: str
    media_type: str
    size_bytes: int
    sha256: str
    created_by: str


class AssetUploadSession(BaseModel):
    upload_session_id: str
    intent_id: str
    state: Literal["pending", "uploading", "completed", "failed", "aborted"]
    user_id: str
    category: str
    filename: str
    media_type: str
    size_bytes: int
    expires_at: datetime
    upload_url: str
    asset_id: str | None = None
    revision_id: str | None = None


class AssetClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._http = httpx.AsyncClient(
            base_url=self._settings.asset_service_url.rstrip("/"),
            timeout=httpx.Timeout(300.0, connect=3.0),
            headers={"X-Internal-Token": self._settings.internal_api_token, "X-Caller-Service": "admin"},
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

    async def create_upload_session(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        user_id: str,
        intent_id: str,
        filename: str,
        media_type: str,
        size_bytes: int,
        category: str,
    ) -> AssetUploadSession:
        response = await self._http.post(
            "/internal/upload-sessions",
            json={
                "tenant_id": tenant_id,
                "workspace_id": workspace_id,
                "user_id": user_id,
                "intent_id": intent_id,
                "filename": filename,
                "media_type": media_type,
                "size_bytes": size_bytes,
                "category": category,
            },
            headers=propagation_headers(),
        )
        response.raise_for_status()
        return AssetUploadSession.model_validate(response.json())

    async def get_upload_session(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        upload_session_id: str,
    ) -> AssetUploadSession:
        response = await self._http.get(
            f"/internal/upload-sessions/{upload_session_id}",
            params={"tenant_id": tenant_id, "workspace_id": workspace_id},
            headers=propagation_headers(),
        )
        response.raise_for_status()
        return AssetUploadSession.model_validate(response.json())

    async def download_to(self, *, revision: AssetRevision, tenant_id: str, workspace_id: str, target: Path) -> None:
        limit = get_settings().skill_archive_max_bytes
        if revision.size_bytes > limit:
            raise ValueError("skill archive exceeds configured byte limit")
        async with self._http.stream(
            "GET",
            f"/internal/assets/{revision.asset_id}/revisions/{revision.revision_id}/content",
            params={"tenant_id": tenant_id, "workspace_id": workspace_id},
            headers=propagation_headers(),
        ) as response:
            response.raise_for_status()
            written = 0
            digest = hashlib.sha256()
            try:
                with target.open("xb") as output:
                    async for chunk in response.aiter_bytes():
                        written += len(chunk)
                        if written > limit:
                            raise ValueError("skill archive exceeds configured byte limit")
                        digest.update(chunk)
                        output.write(chunk)
            except BaseException:
                target.unlink(missing_ok=True)
                raise
        if written != revision.size_bytes:
            target.unlink(missing_ok=True)
            raise ValueError("downloaded skill archive size does not match Asset metadata")
        if digest.hexdigest() != revision.sha256:
            target.unlink(missing_ok=True)
            raise ValueError("downloaded skill archive checksum does not match Asset metadata")

    async def upload_file(
        self,
        *,
        path: Path,
        tenant_id: str,
        workspace_id: str,
        user_id: str,
        filename: str,
        media_type: str,
        idempotency_key: str,
    ) -> AssetRevision:
        async def chunks() -> AsyncIterator[bytes]:
            with path.open("rb") as source:
                while chunk := await asyncio.to_thread(source.read, 256 * 1024):
                    yield chunk

        response = await self._http.post(
            "/internal/assets",
            params={
                "tenant_id": tenant_id,
                "workspace_id": workspace_id,
                "user_id": user_id,
                "filename": filename,
                "category": "skill-attachment",
                "idempotency_key": idempotency_key,
            },
            headers={"Content-Type": media_type, **propagation_headers()},
            content=chunks(),
        )
        response.raise_for_status()
        return AssetRevision.model_validate(response.json())

    async def delivery_url(self, *, tenant_id: str, workspace_id: str, asset_id: str, revision_id: str) -> str:
        response = await self._http.post(
            "/internal/delivery-capabilities:mint",
            json={
                "items": [
                    {
                        "tenant_id": tenant_id,
                        "workspace_id": workspace_id,
                        "asset_id": asset_id,
                        "revision_id": revision_id,
                    }
                ]
            },
            headers=propagation_headers(),
        )
        response.raise_for_status()
        return str(response.json()["items"][0]["url"])

    async def deliver_claim(self, intent: AssetClaimIntentRow) -> None:
        common = {
            "tenant_id": intent.tenant_id,
            "workspace_id": intent.workspace_id,
            "owner_type": intent.owner_type,
            "owner_id": intent.owner_id,
            "slot": intent.slot,
            "generation": intent.generation,
        }
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
        action = "release" if intent.desired_state == "released" else "activate"
        response = await self._http.post(f"/internal/claims:{action}", json=common, headers=propagation_headers())
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


async def ensure_asset_claim(
    session: AsyncSession,
    *,
    tenant_id: str,
    workspace_id: str,
    owner_type: str,
    owner_id: str,
    slot: str,
    asset_id: str,
    revision_id: str,
    desired_state: Literal["active", "released"],
    kind: str = "strong",
) -> None:
    now = datetime.now(UTC)
    excluded = insert(AssetClaimIntentRow).excluded
    await session.execute(
        insert(AssetClaimIntentRow)
        .values(
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            owner_type=owner_type,
            owner_id=owner_id,
            slot=slot,
            asset_id=asset_id,
            revision_id=revision_id,
            kind=kind,
            generation=1,
            desired_state=desired_state,
            next_attempt_at=now,
            state_version=1,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[
                AssetClaimIntentRow.tenant_id,
                AssetClaimIntentRow.workspace_id,
                AssetClaimIntentRow.owner_type,
                AssetClaimIntentRow.owner_id,
                AssetClaimIntentRow.slot,
            ],
            set_={
                "asset_id": excluded.asset_id,
                "revision_id": excluded.revision_id,
                "kind": excluded.kind,
                "generation": AssetClaimIntentRow.generation + 1,
                "desired_state": excluded.desired_state,
                "delivered_at": None,
                "attempt_count": 0,
                "next_attempt_at": now,
                "lease_until": None,
                "state_version": AssetClaimIntentRow.state_version + 1,
                "last_error": None,
                "updated_at": now,
            },
        )
    )


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
                        AssetClaimIntentRow.next_attempt_at,
                        AssetClaimIntentRow.updated_at,
                        AssetClaimIntentRow.tenant_id,
                        AssetClaimIntentRow.workspace_id,
                        AssetClaimIntentRow.owner_id,
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

    async def deliver(row: AssetClaimIntentRow) -> tuple[AssetClaimIntentRow, Literal["ok", "error"], str | None]:
        try:
            await get_asset_client().deliver_claim(row)
            return row, "ok", None
        except Exception as exc:
            logger.warning("asset claim delivery failed for %s:%s", row.owner_type, row.owner_id, exc_info=True)
            return row, "error", str(exc)[:500]

    results = await asyncio.gather(*(deliver(row) for row in rows))
    if results:
        async with factory() as session, write_tx(session):
            completed_at = datetime.now(UTC)
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
                    AssetClaimIntentRow.lease_until > completed_at,
                )
                values = (
                    {
                        "delivered_at": completed_at,
                        "lease_until": None,
                        "state_version": row.state_version + 1,
                        "last_error": None,
                        "updated_at": completed_at,
                    }
                    if status == "ok"
                    else {
                        "attempt_count": AssetClaimIntentRow.attempt_count + 1,
                        "next_attempt_at": completed_at
                        + timedelta(seconds=min(300, 2 ** min(row.attempt_count + 1, 8))),
                        "lease_until": None,
                        "state_version": row.state_version + 1,
                        "last_error": error,
                        "updated_at": completed_at,
                    }
                )
                await session.execute(update(AssetClaimIntentRow).where(*identity).values(**values))
    return sum(status == "ok" for _, status, _ in results)


async def run_asset_claim_relay(stop: asyncio.Event) -> None:
    interval = get_settings().asset_claim_dispatch_interval_seconds
    while not stop.is_set():
        try:
            await dispatch_pending_asset_claims()
        except Exception:
            logger.exception("asset claim relay failed; retrying")
        with suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)
