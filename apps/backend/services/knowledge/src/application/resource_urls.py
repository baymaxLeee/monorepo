"""Short-lived capability URLs for document source objects."""

from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from bootstrap.config import get_settings
from infrastructure.persistence.models.document import DocumentRow

RESOURCE_URL_TTL = timedelta(hours=1)
_SIGNING_CONTEXT = b"knowledge-resource-url-v1"


def document_resource_version(row: DocumentRow) -> str:
    return row.object_sha256 or row.updated_at.isoformat()


def create_document_resource_url(row: DocumentRow) -> tuple[str, datetime]:
    expires_at = datetime.now(UTC) + RESOURCE_URL_TTL
    expires = int(expires_at.timestamp())
    version = document_resource_version(row)
    signature = _sign(row.id, version, expires)
    query = urlencode(
        {
            "expires": expires,
            "version": version,
            "signature": signature,
        }
    )
    return f"/api/knowledge-server/resources/{row.id}?{query}", expires_at


def verify_document_resource_url(
    *,
    document_id: str,
    version: str,
    expires: int,
    signature: str,
) -> bool:
    if expires <= int(datetime.now(UTC).timestamp()):
        return False
    expected = _sign(document_id, version, expires)
    return hmac.compare_digest(expected, signature)


def _sign(document_id: str, version: str, expires: int) -> str:
    key = hashlib.sha256(get_settings().internal_api_token.encode() + b"\0" + _SIGNING_CONTEXT).digest()
    payload = f"{document_id}\n{version}\n{expires}".encode()
    return hmac.new(key, payload, hashlib.sha256).hexdigest()
