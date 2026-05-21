"""Minimal HTTP client wrapper with timeout + retry baseline."""

from typing import Any

import httpx


class HTTPClient:
    def __init__(self, base_url: str, *, timeout: float = 5.0) -> None:
        self._client = httpx.AsyncClient(base_url=base_url, timeout=timeout)

    async def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self._client.get(path, **kwargs)

    async def post(self, path: str, json: Any | None = None, **kwargs: Any) -> httpx.Response:
        return await self._client.post(path, json=json, **kwargs)

    async def aclose(self) -> None:
        await self._client.aclose()
