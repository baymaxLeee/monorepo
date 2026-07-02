"""Admin provider client for vision conversion during ingest."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import httpx
from cachetools import TTLCache
from kernel.errors import BaseError
from knowledge.config import Settings, get_settings


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


class AdminClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._http = httpx.AsyncClient(
            base_url=self._settings.admin_service_url.rstrip("/"),
            timeout=httpx.Timeout(10.0, connect=3.0),
            headers={"X-Internal-Token": self._settings.internal_api_token},
        )
        self._cache: TTLCache[tuple[str, str | None], ProviderSnapshot] = TTLCache(maxsize=256, ttl=300.0)
        self._cache_lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._http.aclose()

    async def get_provider(self, *, user_id: str, provider_id: str | None = None) -> ProviderSnapshot:
        cache_key = (user_id, provider_id)
        if (cached := self._cache.get(cache_key)) is not None:
            return cached
        async with self._cache_lock:
            if (cached := self._cache.get(cache_key)) is not None:
                return cached
            url = f"/internal/providers/{provider_id}" if provider_id else "/internal/providers/default"
            snapshot = await self._fetch(url, user_id=user_id)
            self._cache[cache_key] = snapshot
            if provider_id is None:
                self._cache[(user_id, snapshot.id)] = snapshot
            return snapshot

    async def get_provider_by_kind(self, *, user_id: str, kind: str) -> ProviderSnapshot:
        """Resolve the user's provider for a non-chat kind (embedding, rerank).

        Cached by (user_id, "kind:<kind>") so RAG indexing/retrieval does not hit
        admin on every chunk/query.
        """
        cache_key = (user_id, f"kind:{kind}")
        if (cached := self._cache.get(cache_key)) is not None:
            return cached
        async with self._cache_lock:
            if (cached := self._cache.get(cache_key)) is not None:
                return cached
            snapshot = await self._fetch(f"/internal/providers/by-kind/{kind}", user_id=user_id)
            self._cache[cache_key] = snapshot
            return snapshot

    async def _fetch(self, url: str, *, user_id: str) -> ProviderSnapshot:
        try:
            response = await self._http.get(url, params={"user_id": user_id})
        except httpx.HTTPError as exc:
            raise AdminUnavailableError(f"admin unreachable: {exc}") from exc
        if response.status_code == 404:
            raise ProviderNotConfiguredError("no model provider configured")
        if response.status_code >= 400:
            raise AdminUnavailableError(f"admin refused: {response.status_code}")
        data = response.json()
        return ProviderSnapshot(
            id=data["id"],
            user_id=data["user_id"],
            name=data["name"],
            model=data["model"],
            base_url=data["base_url"],
            api_key=data["api_key"],
            extra_body=data.get("extra_body") or {},
            is_default=data["is_default"],
            is_enabled=data["is_enabled"],
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
