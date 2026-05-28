"""Client for admin service `/internal/providers/...` API.

`chat` does not own any LLM credentials. On every reply we ask `admin` for a
fully-decrypted provider snapshot (model + base_url + api_key + extra_body)
keyed by the end-user and an optional `provider_id`. The snapshot is cached
in-process with a short TTL so a long streaming reply doesn't trigger a
sibling-RPC per chunk; the TTL is also why admin rotations propagate
naturally within ~5 minutes without coordination.

Failure modes are mapped onto domain errors so the SSE handler can render
them as actionable client messages:

- `provider_not_configured` — no default provider for this user, or the
  requested provider_id doesn't exist / is disabled.
- `admin_unavailable`       — admin returned 5xx or refused the connection;
  surfaced separately because retrying chat won't fix it.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import httpx
from cachetools import TTLCache
from kernel.errors import BaseError

from chat.config import Settings, get_settings


class ProviderNotConfiguredError(BaseError):
    status_code = 412  # Precondition Failed: user must configure a provider first
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
    """Single shared instance per process (see `get_admin_client`)."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._http = httpx.AsyncClient(
            base_url=settings.admin_service_url.rstrip("/"),
            timeout=httpx.Timeout(10.0, connect=3.0),
            headers={"X-Internal-Token": settings.internal_api_token},
        )
        self._cache: TTLCache[tuple[str, str | None], ProviderSnapshot] = TTLCache(
            maxsize=settings.provider_cache_size,
            ttl=settings.provider_cache_ttl_seconds,
        )
        self._cache_lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._http.aclose()

    async def get_provider(
        self,
        *,
        user_id: str,
        provider_id: str | None = None,
    ) -> ProviderSnapshot:
        """Return a decrypted provider snapshot, falling back to user default."""

        cache_key = (user_id, provider_id)
        if (cached := self._cache.get(cache_key)) is not None:
            return cached

        async with self._cache_lock:
            if (cached := self._cache.get(cache_key)) is not None:
                return cached
            snapshot = await self._fetch(user_id=user_id, provider_id=provider_id)
            self._cache[cache_key] = snapshot
            # Also memoize the default lookup under its explicit id so that
            # the next chunk doesn't need to call admin again with provider_id.
            if provider_id is None:
                self._cache[(user_id, snapshot.id)] = snapshot
            return snapshot

    def invalidate(self, user_id: str, provider_id: str | None = None) -> None:
        if provider_id is None:
            self._cache.clear()
            return
        self._cache.pop((user_id, provider_id), None)
        self._cache.pop((user_id, None), None)

    async def _fetch(self, *, user_id: str, provider_id: str | None) -> ProviderSnapshot:
        url = f"/internal/providers/{provider_id}" if provider_id else "/internal/providers/default"
        try:
            response = await self._http.get(url, params={"user_id": user_id})
        except httpx.HTTPError as exc:
            raise AdminUnavailableError(f"admin service unreachable: {exc}") from exc

        if response.status_code == 404:
            raise ProviderNotConfiguredError(
                "no model provider configured; open Admin → 模型管理 to add one",
            )
        if response.status_code == 409:
            raise ProviderNotConfiguredError(
                "the requested model provider is disabled",
            )
        if response.status_code >= 500:
            raise AdminUnavailableError(
                f"admin /internal/providers returned {response.status_code}: {response.text[:200]}",
            )
        if response.status_code >= 400:
            # 401/403 from admin means our internal_api_token is wrong —
            # surface as 502 (config error, not user-actionable from the
            # frontend) rather than leaking the 401 to the browser.
            raise AdminUnavailableError(
                f"admin /internal/providers refused (status={response.status_code}): {response.text[:200]}",
            )

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
        _client = AdminClient(get_settings())
    return _client


async def close_admin_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
