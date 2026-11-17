"""Asset control-plane client and durable Claim relay."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Literal, TypedDict, cast

import common.v1.context_pb2 as context_pb2
import grpc
import storage.v1.storage_pb2 as storage_pb2
import storage.v1.storage_pb2_grpc as storage_pb2_grpc
from bootstrap.config import Settings, get_settings
from infrastructure.persistence.database import get_session_factory, write_tx
from infrastructure.persistence.models.asset_claim_intent import AssetClaimIntentRow
from knowledge_kernel.tracing import propagation_headers
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("knowledge.asset")


class _CallOptions(TypedDict):
    metadata: list[tuple[str, str]]
    timeout: float


class StorageRevision(BaseModel):
    asset_id: str
    revision_id: str
    category: str
    filename: str
    media_type: str
    size_bytes: int
    sha256: str
    created_by: str


class StorageDelivery(BaseModel):
    asset_id: str
    revision_id: str
    url: str
    expires_at: datetime
    filename: str
    media_type: str
    size_bytes: int


class StorageUploadSession(BaseModel):
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


class StorageClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._channel = grpc.aio.insecure_channel(self._settings.storage_rpc_target)
        self._assets = storage_pb2_grpc.AssetServiceStub(self._channel)
        self._claims = storage_pb2_grpc.ClaimServiceStub(self._channel)
        self._uploads = storage_pb2_grpc.UploadSessionServiceStub(self._channel)
        self._delivery = storage_pb2_grpc.DeliveryServiceStub(self._channel)

    async def aclose(self) -> None:
        await self._channel.close()

    @staticmethod
    def _actor(tenant_id: str, workspace_id: str, user_id: str = "") -> context_pb2.ActorContext:
        return context_pb2.ActorContext(tenant_id=tenant_id, workspace_id=workspace_id, user_id=user_id)

    @staticmethod
    def _options(timeout: float = 30.0) -> _CallOptions:
        metadata = [("x-caller-service", "knowledge")]
        metadata.extend((key.lower(), value) for key, value in propagation_headers().items())
        return {"metadata": metadata, "timeout": timeout}

    async def mint_delivery(
        self, *, tenant_id: str, workspace_id: str, asset_id: str, revision_id: str
    ) -> StorageDelivery:
        result = await self._delivery.MintCapabilities(
            storage_pb2.MintCapabilitiesRequest(
                items=[
                    storage_pb2.DeliveryCapabilityItem(
                        actor=self._actor(tenant_id, workspace_id), asset_id=asset_id, revision_id=revision_id
                    )
                ]
            ),
            **self._options(),
        )
        if len(result.items) != 1:
            raise RuntimeError("storage returned no delivery capability")
        value = result.items[0]
        return StorageDelivery(
            asset_id=value.asset_id,
            revision_id=value.revision_id,
            url=value.url,
            expires_at=value.expires_at.ToDatetime(tzinfo=UTC),
            filename=value.filename,
            media_type=value.media_type,
            size_bytes=value.size_bytes,
        )

    async def upload_text(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        user_id: str,
        filename: str,
        media_type: str,
        content: str,
        idempotency_key: str,
    ) -> StorageRevision:
        async def requests() -> AsyncIterator[storage_pb2.UploadRequest]:
            yield storage_pb2.UploadRequest(
                metadata=storage_pb2.UploadMetadata(
                    actor=self._actor(tenant_id, workspace_id, user_id),
                    filename=filename,
                    media_type=media_type,
                    category="knowledge-file",
                    idempotency_key=idempotency_key,
                )
            )
            raw = content.encode("utf-8")
            for offset in range(0, len(raw), 64 * 1024):
                yield storage_pb2.UploadRequest(chunk=raw[offset : offset + 64 * 1024])

        response = await self._assets.Upload(requests(), **self._options(180.0))
        value = response.result
        return StorageRevision(
            asset_id=value.asset_id,
            revision_id=value.revision_id,
            category="knowledge-file",
            filename=value.filename,
            media_type=value.media_type,
            size_bytes=value.size_bytes,
            sha256=value.sha256,
            created_by=user_id,
        )

    async def describe(self, *, tenant_id: str, workspace_id: str, asset_id: str, revision_id: str) -> StorageRevision:
        result = await self._assets.DescribeRevision(
            storage_pb2.DescribeRevisionRequest(
                actor=self._actor(tenant_id, workspace_id), asset_id=asset_id, revision_id=revision_id
            ),
            **self._options(),
        )
        value = result.revision
        return StorageRevision(
            asset_id=value.asset_id,
            revision_id=value.revision_id,
            category=value.category,
            filename=value.filename,
            media_type=value.media_type,
            size_bytes=value.size_bytes,
            sha256=value.sha256,
            created_by=value.created_by,
        )

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
    ) -> StorageUploadSession:
        result = await self._uploads.CreateUploadSession(
            storage_pb2.CreateUploadSessionRequest(
                actor=self._actor(tenant_id, workspace_id, user_id),
                intent_id=intent_id,
                filename=filename,
                media_type=media_type,
                size_bytes=size_bytes,
                category=category,
            ),
            **self._options(),
        )
        return self._upload_session(result.session)

    async def get_upload_session(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        upload_session_id: str,
    ) -> StorageUploadSession:
        result = await self._uploads.DescribeUploadSession(
            storage_pb2.DescribeUploadSessionRequest(
                actor=self._actor(tenant_id, workspace_id), upload_session_id=upload_session_id
            ),
            **self._options(),
        )
        return self._upload_session(result.session)

    async def read(
        self, *, tenant_id: str, workspace_id: str, asset_id: str, revision_id: str, max_bytes: int
    ) -> bytes:
        stream = self._assets.ReadContent(
            storage_pb2.ReadContentRequest(
                actor=self._actor(tenant_id, workspace_id), asset_id=asset_id, revision_id=revision_id
            ),
            **self._options(180.0),
        )
        chunks: list[bytes] = []
        size = 0
        async for response in stream:
            if response.value.HasField("metadata") and response.value.metadata.size_bytes > max_bytes:
                raise ValueError("asset exceeds consumer byte limit")
            if response.value.HasField("chunk"):
                size += len(response.value.chunk)
                if size > max_bytes:
                    raise ValueError("asset exceeds consumer byte limit")
                chunks.append(response.value.chunk)
        return b"".join(chunks)

    async def deliver_claim(self, intent: AssetClaimIntentRow) -> None:
        if intent.revision_id is None:
            raise ValueError("asset claim revision_id is required")
        if intent.desired_state == "released":
            await self._prepare_claim(
                tenant_id=intent.tenant_id,
                workspace_id=intent.workspace_id,
                owner_type=intent.owner_type,
                owner_id=intent.owner_id,
                slot=intent.slot,
                generation=intent.generation,
                asset_id=intent.asset_id,
                revision_id=intent.revision_id,
                kind=intent.kind,
            )
            await self._mutate_claim(
                True,
                tenant_id=intent.tenant_id,
                workspace_id=intent.workspace_id,
                owner_type=intent.owner_type,
                owner_id=intent.owner_id,
                slot=intent.slot,
                generation=intent.generation,
            )
            return
        await self._prepare_claim(
            tenant_id=intent.tenant_id,
            workspace_id=intent.workspace_id,
            owner_type=intent.owner_type,
            owner_id=intent.owner_id,
            slot=intent.slot,
            generation=intent.generation,
            asset_id=intent.asset_id,
            revision_id=intent.revision_id,
            kind=intent.kind,
        )
        await self._mutate_claim(
            False,
            tenant_id=intent.tenant_id,
            workspace_id=intent.workspace_id,
            owner_type=intent.owner_type,
            owner_id=intent.owner_id,
            slot=intent.slot,
            generation=intent.generation,
        )

    async def _prepare_claim(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        owner_type: str,
        owner_id: str,
        slot: str,
        generation: int,
        asset_id: str,
        revision_id: str,
        kind: str,
    ) -> None:
        kinds = {
            "strong": storage_pb2.CLAIM_KIND_STRONG,
            "snapshot": storage_pb2.CLAIM_KIND_SNAPSHOT,
            "lease": storage_pb2.CLAIM_KIND_LEASE,
            "weak": storage_pb2.CLAIM_KIND_WEAK,
        }
        await self._claims.PrepareClaim(
            storage_pb2.PrepareClaimRequest(
                actor=self._actor(tenant_id, workspace_id),
                owner_type=owner_type,
                owner_id=owner_id,
                slot=slot,
                generation=generation,
                asset_id=asset_id,
                revision_id=revision_id,
                kind=kinds[kind],
            ),
            **self._options(),
        )

    async def _mutate_claim(
        self,
        release: bool,
        *,
        tenant_id: str,
        workspace_id: str,
        owner_type: str,
        owner_id: str,
        slot: str,
        generation: int,
    ) -> None:
        if release:
            await self._claims.ReleaseClaim(
                storage_pb2.ReleaseClaimRequest(
                    actor=self._actor(tenant_id, workspace_id),
                    owner_type=owner_type,
                    owner_id=owner_id,
                    slot=slot,
                    generation=generation,
                ),
                **self._options(),
            )
        else:
            await self._claims.ActivateClaim(
                storage_pb2.ActivateClaimRequest(
                    actor=self._actor(tenant_id, workspace_id),
                    owner_type=owner_type,
                    owner_id=owner_id,
                    slot=slot,
                    generation=generation,
                ),
                **self._options(),
            )

    @staticmethod
    def _upload_session(value: storage_pb2.UploadSession) -> StorageUploadSession:
        states: dict[int, Literal["pending", "uploading", "completed", "failed", "aborted"]] = {
            storage_pb2.UPLOAD_SESSION_STATE_PENDING: "pending",
            storage_pb2.UPLOAD_SESSION_STATE_UPLOADING: "uploading",
            storage_pb2.UPLOAD_SESSION_STATE_COMPLETED: "completed",
            storage_pb2.UPLOAD_SESSION_STATE_FAILED: "failed",
            storage_pb2.UPLOAD_SESSION_STATE_ABORTED: "aborted",
        }
        return StorageUploadSession(
            upload_session_id=value.upload_session_id,
            intent_id=value.intent_id,
            state=cast(Literal["pending", "uploading", "completed", "failed", "aborted"], states[value.state]),
            user_id=value.user_id,
            category=value.category,
            filename=value.filename,
            media_type=value.media_type,
            size_bytes=value.size_bytes,
            expires_at=value.expires_at.ToDatetime(tzinfo=UTC),
            upload_url=value.upload_url,
            asset_id=value.asset_id if value.HasField("asset_id") else None,
            revision_id=value.revision_id if value.HasField("revision_id") else None,
        )


_client: StorageClient | None = None


def get_storage_client() -> StorageClient:
    global _client
    if _client is None:
        _client = StorageClient()
    return _client


async def close_storage_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def ensure_content_claim_active(
    session: AsyncSession,
    *,
    tenant_id: str,
    workspace_id: str,
    owner_type: str,
    owner_id: str,
    asset_id: str,
    revision_id: str,
) -> None:
    now = datetime.now(UTC)
    await session.execute(
        insert(AssetClaimIntentRow)
        .values(
            owner_type=owner_type,
            owner_id=owner_id,
            slot="source",
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            asset_id=asset_id,
            revision_id=revision_id,
            kind="strong",
            generation=1,
            desired_state="active",
            next_attempt_at=now,
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
                "tenant_id": tenant_id,
                "workspace_id": workspace_id,
                "asset_id": asset_id,
                "revision_id": revision_id,
                "kind": "strong",
                "generation": AssetClaimIntentRow.generation + 1,
                "desired_state": "active",
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


async def ensure_staged_media_claim_active(
    session: AsyncSession, *, tenant_id: str, workspace_id: str, staged_id: str, asset_id: str, revision_id: str
) -> None:
    now = datetime.now(UTC)
    await session.execute(
        insert(AssetClaimIntentRow)
        .values(
            owner_type="staged_media",
            owner_id=staged_id,
            slot="source",
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            asset_id=asset_id,
            revision_id=revision_id,
            kind="strong",
            generation=1,
            desired_state="active",
            next_attempt_at=now,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=[
                AssetClaimIntentRow.tenant_id,
                AssetClaimIntentRow.workspace_id,
                AssetClaimIntentRow.owner_type,
                AssetClaimIntentRow.owner_id,
                AssetClaimIntentRow.slot,
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
    session: AsyncSession,
    *,
    tenant_id: str,
    workspace_id: str,
    owner_type: str,
    owner_ids: list[str],
    slot: str = "source",
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
            desired_state="released",
            delivered_at=None,
            next_attempt_at=now,
            lease_until=None,
            state_version=AssetClaimIntentRow.state_version + 1,
            attempt_count=0,
            last_error=None,
            updated_at=now,
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
    client = get_storage_client()

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
                        "delivered_at": committed_at,
                        "lease_until": None,
                        "state_version": row.state_version + 1,
                        "last_error": None,
                        "updated_at": committed_at,
                    }
                    if status == "ok"
                    else {
                        "attempt_count": AssetClaimIntentRow.attempt_count + 1,
                        "next_attempt_at": committed_at
                        + timedelta(seconds=min(300, 2 ** min(row.attempt_count + 1, 8))),
                        "lease_until": None,
                        "state_version": row.state_version + 1,
                        "last_error": error,
                        "updated_at": committed_at,
                    }
                )
                await session.execute(update(AssetClaimIntentRow).where(*identity).values(**values))
    return sum(status == "ok" for _, status, _ in results)


async def run_asset_claim_relay(stop: asyncio.Event) -> None:
    interval = max(get_settings().storage_claim_dispatch_interval_seconds, 1.0)
    while not stop.is_set():
        try:
            await dispatch_pending_asset_claims()
        except Exception:
            logger.exception("asset claim relay failed; retrying")
        with suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


async def ensure_document_claim_active(
    session: AsyncSession, *, tenant_id: str, workspace_id: str, document_id: str, asset_id: str, revision_id: str
) -> None:
    await ensure_content_claim_active(
        session,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        owner_type="document",
        owner_id=document_id,
        asset_id=asset_id,
        revision_id=revision_id,
    )
