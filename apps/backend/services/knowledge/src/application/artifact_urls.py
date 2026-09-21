"""Cached capabilities for immutable service-owned artifacts."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import quote, urlencode

from bootstrap.config import get_settings
from infrastructure.cache.redis import get_redis

logger = logging.getLogger("knowledge.artifact_urls")

ARTIFACT_URL_TTL = timedelta(hours=24)
_MIN_CACHE_TTL_SECONDS = 6 * 60 * 60
_MAX_CACHE_TTL_SECONDS = 8 * 60 * 60
_SIGNING_CONTEXT = b"knowledge-artifact-url-v1"
_NAMESPACE = re.compile(r"^[a-f0-9]{64}$")
_ARTIFACT_ID = re.compile(r"^[a-f0-9]{64}$")
_CONTENT_TYPE = re.compile(r"^[a-z0-9][a-z0-9.+-]{0,63}/[a-z0-9][a-z0-9.+-]{0,63}$")


def valid_artifact_identity(namespace: str, artifact_id: str) -> bool:
    return bool(_NAMESPACE.fullmatch(namespace) and _ARTIFACT_ID.fullmatch(artifact_id))


def valid_content_type(content_type: str) -> bool:
    return bool(_CONTENT_TYPE.fullmatch(content_type))


async def create_artifact_url(namespace: str, artifact_id: str, content_type: str) -> tuple[str, datetime]:
    cache_key = f"knowledge:artifact-url:v1:{namespace}:{artifact_id}:{content_type}"
    now = datetime.now(UTC)
    try:
        cached = await get_redis().get(cache_key)
        if cached:
            value = json.loads(cached)
            expires_at = datetime.fromisoformat(value["expires_at"])
            if expires_at > now:
                return str(value["url"]), expires_at
    except Exception:
        logger.warning("artifact URL cache read failed", exc_info=True)

    expires_at = now + ARTIFACT_URL_TTL
    expires = int(expires_at.timestamp())
    signature = _sign(namespace, artifact_id, content_type, expires)
    query = urlencode({"expires": expires, "content_type": content_type, "signature": signature})
    url = f"/api/knowledge-server/media/artifacts/{quote(namespace)}/{quote(artifact_id)}?{query}"
    try:
        remaining_ttl = max(1, expires - int(datetime.now(UTC).timestamp()))
        ttl = min(remaining_ttl, _presign_cache_ttl_seconds())
        await get_redis().set(cache_key, json.dumps({"url": url, "expires_at": expires_at.isoformat()}), ex=ttl)
    except Exception:
        logger.warning("artifact URL cache write failed", exc_info=True)
    return url, expires_at


def verify_artifact_url(*, namespace: str, artifact_id: str, content_type: str, expires: int, signature: str) -> bool:
    now = int(datetime.now(UTC).timestamp())
    if expires <= now or expires > now + int(ARTIFACT_URL_TTL.total_seconds()):
        return False
    expected = _sign(namespace, artifact_id, content_type, expires)
    return hmac.compare_digest(expected, signature)


def _sign(namespace: str, artifact_id: str, content_type: str, expires: int) -> str:
    key = hashlib.sha256(get_settings().internal_api_token.encode() + b"\0" + _SIGNING_CONTEXT).digest()
    payload = f"{namespace}\n{artifact_id}\n{content_type}\n{expires}".encode()
    return hmac.new(key, payload, hashlib.sha256).hexdigest()


def _presign_cache_ttl_seconds() -> int:
    spread = _MAX_CACHE_TTL_SECONDS - _MIN_CACHE_TTL_SECONDS
    return _MIN_CACHE_TTL_SECONDS + secrets.randbelow(spread + 1)
