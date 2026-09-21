"""Short-lived public Canvas media URLs for external review providers."""

import hashlib
import hmac
import re
import time

from application.object_store import ObjectStore
from bootstrap.config import get_settings
from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from kernel.errors import RequestError, UnauthorizedError

router = APIRouter(prefix="/media/canvas", tags=["canvas-media"])


@router.get("/{scope}/{key}", include_in_schema=False)
def get_canvas_media(
    scope: str, key: str, expires: int = Query(gt=0), signature: str = Query(min_length=64, max_length=64)
) -> FileResponse:
    if not re.fullmatch(r"[a-f0-9]{64}", scope) or not re.fullmatch(r"[a-f0-9]{64}", key):
        raise RequestError("invalid canvas media key")
    now = int(time.time())
    if expires <= now or expires > now + 3600:
        raise UnauthorizedError("canvas media URL expired")
    message = f"{scope}\n{key}\n{expires}".encode()
    expected = hmac.new(get_settings().internal_api_token.encode(), message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise UnauthorizedError("invalid canvas media signature")
    path = ObjectStore().get_path(
        bucket=get_settings().default_bucket,
        key=f"service-objects/canvas/{scope}/{key}",
    )
    return FileResponse(path, media_type="application/octet-stream")
