"""Internal client for storage service object APIs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from kernel.errors import BaseError

from chat.config import Settings, get_settings


class StorageUnavailableError(BaseError):
    status_code = 502
    code = "storage_unavailable"


@dataclass(frozen=True)
class StoredObject:
    bucket: str
    key: str
    etag: str
    sha256: str
    size: int
    content_type: str


class StorageClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    async def put_bytes(
        self,
        *,
        content: bytes,
        filename: str,
        mime_type: str,
        user_id: str,
        prefix: str = "chat",
    ) -> StoredObject:
        async with httpx.AsyncClient(
            base_url=self._settings.storage_service_url.rstrip("/"),
            timeout=httpx.Timeout(30.0, connect=3.0),
            headers={"X-Internal-Token": self._settings.internal_api_token},
        ) as client:
            try:
                response = await client.post(
                    "/internal/objects",
                    data={
                        "bucket": "chat",
                        "prefix": prefix,
                        "user_id": user_id,
                    },
                    files={"file": (filename, content, mime_type)},
                )
            except httpx.HTTPError as exc:
                raise StorageUnavailableError(f"storage service unreachable: {exc}") from exc
        if response.status_code >= 400:
            raise StorageUnavailableError(
                f"storage service rejected upload (status={response.status_code}): {response.text[:200]}"
            )
        return _stored_object(response.json())

    async def get_bytes(self, *, bucket: str, key: str) -> bytes:
        async with httpx.AsyncClient(
            base_url=self._settings.storage_service_url.rstrip("/"),
            timeout=httpx.Timeout(30.0, connect=3.0),
            headers={"X-Internal-Token": self._settings.internal_api_token},
        ) as client:
            try:
                response = await client.get(f"/internal/buckets/{bucket}/objects/{key}")
            except httpx.HTTPError as exc:
                raise StorageUnavailableError(f"storage service unreachable: {exc}") from exc
        if response.status_code >= 400:
            raise StorageUnavailableError(
                f"storage service rejected download (status={response.status_code}): {response.text[:200]}"
            )
        return response.content

    async def delete(self, *, bucket: str, key: str) -> None:
        async with httpx.AsyncClient(
            base_url=self._settings.storage_service_url.rstrip("/"),
            timeout=httpx.Timeout(10.0, connect=3.0),
            headers={"X-Internal-Token": self._settings.internal_api_token},
        ) as client:
            try:
                response = await client.delete(f"/internal/buckets/{bucket}/objects/{key}")
            except httpx.HTTPError:
                return
        if response.status_code in {404, 204}:
            return


def _stored_object(data: dict[str, Any]) -> StoredObject:
    return StoredObject(
        bucket=str(data["bucket"]),
        key=str(data["key"]),
        etag=str(data.get("etag") or ""),
        sha256=str(data.get("sha256") or ""),
        size=int(data.get("size") or 0),
        content_type=str(data.get("content_type") or "application/octet-stream"),
    )
