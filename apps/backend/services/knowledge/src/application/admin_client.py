"""Typed Admin gRPC client for model-provider resolution."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import admin.v1.admin_pb2 as admin_pb2
import admin.v1.admin_pb2_grpc as admin_pb2_grpc
import common.v1.context_pb2 as context_pb2
import grpc
from bootstrap.config import Settings, get_settings
from cachetools import TTLCache
from google.protobuf.json_format import MessageToDict
from knowledge_kernel.errors import BaseError
from knowledge_kernel.tracing import propagation_headers


class ProviderNotConfiguredError(BaseError):
    status_code = 412
    code = "provider_not_configured"


class AdminUnavailableError(BaseError):
    status_code = 502
    code = "admin_unavailable"


@dataclass(frozen=True)
class ProviderSnapshot:
    id: str
    user_id: str
    name: str
    model: str
    base_url: str
    api_key: str
    extra_body: dict[str, Any]
    is_default: bool
    is_enabled: bool
    supports_image_input: bool = False


_KINDS = {
    "chat": admin_pb2.PROVIDER_KIND_CHAT,
    "image": admin_pb2.PROVIDER_KIND_IMAGE,
    "video": admin_pb2.PROVIDER_KIND_VIDEO,
    "embedding": admin_pb2.PROVIDER_KIND_EMBEDDING,
    "rerank": admin_pb2.PROVIDER_KIND_RERANK,
}


class AdminClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._channel = grpc.aio.insecure_channel(self._settings.admin_rpc_target)
        self._client = admin_pb2_grpc.ProviderServiceStub(self._channel)
        self._cache: TTLCache[tuple[str, ...], ProviderSnapshot] = TTLCache(maxsize=256, ttl=300.0)
        self._cache_lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._channel.close()

    async def get_provider(
        self, *, workspace_id: str, tenant_id: str, provider_id: str | None = None
    ) -> ProviderSnapshot:
        cache_key = (
            ("id", tenant_id, workspace_id, provider_id) if provider_id else ("workspace", tenant_id, workspace_id)
        )
        if (cached := self._cache.get(cache_key)) is not None:
            return cached
        async with self._cache_lock:
            if (cached := self._cache.get(cache_key)) is not None:
                return cached
            actor = context_pb2.ActorContext(tenant_id=tenant_id, workspace_id=workspace_id)
            if provider_id:
                response = await self._request(
                    self._client.GetProvider(
                        admin_pb2.GetProviderRequest(actor=actor, provider_id=provider_id), **self._call_options()
                    )
                )
            else:
                response = await self._request(
                    self._client.GetDefaultProvider(
                        admin_pb2.GetDefaultProviderRequest(actor=actor), **self._call_options()
                    )
                )
            snapshot = self._snapshot(response.provider)
            self._cache[cache_key] = snapshot
            self._cache["id", tenant_id, workspace_id, snapshot.id] = snapshot
            return snapshot

    async def get_provider_by_kind(self, *, workspace_id: str, tenant_id: str, kind: str) -> ProviderSnapshot:
        cache_key = ("workspace", tenant_id, workspace_id, kind)
        if (cached := self._cache.get(cache_key)) is not None:
            return cached
        if kind not in _KINDS:
            raise ProviderNotConfiguredError(f"unsupported provider kind: {kind}")
        async with self._cache_lock:
            if (cached := self._cache.get(cache_key)) is not None:
                return cached
            response = await self._request(
                self._client.GetProviderByKind(
                    admin_pb2.GetProviderByKindRequest(
                        actor=context_pb2.ActorContext(tenant_id=tenant_id, workspace_id=workspace_id),
                        kind=_KINDS[kind],
                    ),
                    **self._call_options(),
                )
            )
            snapshot = self._snapshot(response.provider)
            self._cache[cache_key] = snapshot
            return snapshot

    async def _request(self, request: Any) -> Any:
        try:
            return await request
        except grpc.aio.AioRpcError as exc:
            if exc.code() is grpc.StatusCode.NOT_FOUND:
                raise ProviderNotConfiguredError("no model provider configured") from exc
            raise AdminUnavailableError(f"admin RPC failed: {exc.code().name}") from exc

    def _call_options(self) -> dict[str, Any]:
        metadata = [("x-caller-service", "knowledge")]
        metadata.extend((key.lower(), value) for key, value in propagation_headers().items())
        return {"metadata": metadata, "timeout": 10.0}

    @staticmethod
    def _snapshot(data: admin_pb2.ModelProvider) -> ProviderSnapshot:
        return ProviderSnapshot(
            id=data.id,
            user_id=data.user_id,
            name=data.name,
            model=data.model,
            base_url=data.base_url,
            api_key=data.api_key,
            extra_body=MessageToDict(data.extra_body),
            is_default=data.is_default,
            is_enabled=data.is_enabled,
            supports_image_input=data.supports_image_input,
        )


_client: AdminClient | None = None


def get_admin_client() -> AdminClient:
    global _client
    if _client is None:
        _client = AdminClient()
    return _client


async def close_admin_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
