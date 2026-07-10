"""Local filesystem object store (replaces Go storage service)."""

from __future__ import annotations

import hashlib
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from config import Settings, get_settings
from kernel.errors import BaseError, RequestError

_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9._=-]+$")


class ObjectStoreError(BaseError):
    status_code = 502
    code = "object_store_failed"


class ObjectTooLargeError(BaseError):
    status_code = 413
    code = "object_too_large"


@dataclass(frozen=True)
class StoredObject:
    bucket: str
    key: str
    sha256: str
    size: int
    content_type: str
    path: Path


class ObjectStore:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._root = Path(self._settings.knowledge_data_dir).resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def put_bytes(
        self,
        *,
        content: bytes,
        filename: str,
        mime_type: str,
        user_id: str,
        prefix: str = "uploads",
        max_bytes: int | None = None,
    ) -> StoredObject:
        limit = max_bytes if max_bytes is not None else self._settings.max_object_bytes
        if len(content) > limit:
            raise ObjectTooLargeError(
                "object exceeds max size",
                details={"max_bytes": limit, "actual_bytes": len(content)},
            )
        bucket = self._settings.default_bucket
        safe_name = self._safe_filename_segment(filename)
        key = self._safe_key(prefix, user_id, safe_name)
        if not _SAFE_SEGMENT.match(bucket) or not self._valid_key(key):
            raise RequestError("invalid bucket or object key")

        final_path = self._root / bucket / key
        final_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = final_path.with_suffix(final_path.suffix + f".{uuid.uuid4().hex}.tmp")
        sha = hashlib.sha256(content).hexdigest()
        temp_path.write_bytes(content)
        os.replace(temp_path, final_path)
        return StoredObject(
            bucket=bucket,
            key=key,
            sha256=sha,
            size=len(content),
            content_type=mime_type or "application/octet-stream",
            path=final_path,
        )

    def put_bytes_at(self, *, bucket: str, key: str, content: bytes) -> None:
        """Write bytes to an explicit, caller-computed key (unlike ``put_bytes``
        which derives the key). Used for deterministic derived objects such as
        cached downscaled image variants keyed by source hash + params."""
        if not _SAFE_SEGMENT.match(bucket) or not self._valid_key(key):
            raise RequestError("invalid bucket or object key")
        final_path = self._root / bucket / key
        final_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = final_path.with_suffix(final_path.suffix + f".{uuid.uuid4().hex}.tmp")
        temp_path.write_bytes(content)
        os.replace(temp_path, final_path)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        path = self._root / bucket / key
        if not path.is_file():
            raise ObjectStoreError("object not found", details={"bucket": bucket, "key": key})
        return path.read_bytes()

    def delete(self, *, bucket: str, key: str) -> None:
        path = self._root / bucket / key
        if path.is_file():
            path.unlink()

    @staticmethod
    def _safe_filename_segment(filename: str) -> str:
        """Coerce any (possibly non-ASCII) filename into a storage-key-safe
        segment. The human-facing filename is kept in document metadata; only
        the on-disk object key must stay within the safe charset, so a Chinese
        or otherwise non-ASCII title must never reject the write."""
        base = Path(filename or "").name
        stem, dot, ext = base.rpartition(".")
        if not dot:
            stem, ext = base, ""
        safe_stem = re.sub(r"[^A-Za-z0-9_=-]+", "-", stem)
        safe_stem = re.sub(r"-{2,}", "-", safe_stem).strip("-_=")
        safe_ext = re.sub(r"[^A-Za-z0-9]+", "", ext)[:16]
        if not safe_stem:
            safe_stem = f"file-{hashlib.sha256(base.encode()).hexdigest()[:16]}"
        safe_stem = safe_stem[:180]
        return f"{safe_stem}.{safe_ext}" if safe_ext else safe_stem

    @staticmethod
    def _safe_key(prefix: str, user_id: str, filename: str) -> str:
        parts = [p for p in [prefix.strip("/"), user_id, filename] if p]
        return "/".join(parts)

    @staticmethod
    def _valid_key(key: str) -> bool:
        if not key or key.startswith("/") or ".." in key:
            return False
        return all(_SAFE_SEGMENT.match(part) for part in key.split("/"))
