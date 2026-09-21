"""Immutable service-owned objects; lifecycle remains with the owning service."""

import hashlib
import re
from typing import Annotated

from application.object_store import ObjectStore
from bootstrap.config import get_settings
from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import FileResponse
from kernel.errors import RequestError, UnauthorizedError
from pydantic import BaseModel

from api.http.dependencies import require_internal_token

router = APIRouter(prefix="/internal/objects", tags=["service-objects"], dependencies=[Depends(require_internal_token)])


class StoredServiceObject(BaseModel):
    key: str
    size: int
    sha256: str


def check_scope(caller: str, scope: str) -> None:
    if caller not in {"canvas", "executor"}:
        raise UnauthorizedError("caller does not own this object namespace")
    if not re.fullmatch(r"[a-f0-9]{64}", scope):
        raise RequestError("invalid object scope")


@router.post("/{scope}", response_model=StoredServiceObject)
async def put_object(
    scope: str, request: Request, caller: Annotated[str, Header(alias="X-Caller-Service")]
) -> StoredServiceObject:
    check_scope(caller, scope)
    limit = get_settings().media_max_object_bytes
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > limit:
            raise RequestError("media exceeds the configured storage limit")
        content.extend(chunk)
    if not content:
        raise RequestError("empty media")
    digest = hashlib.sha256(content).hexdigest()
    stored = ObjectStore().put_bytes(
        content=bytes(content),
        filename=digest,
        mime_type="application/octet-stream",
        user_id=scope,
        prefix="service-objects/canvas",
        max_bytes=limit,
    )
    return StoredServiceObject(key=digest, size=stored.size, sha256=digest)


@router.get("/{scope}/{key}")
def get_object(scope: str, key: str, caller: Annotated[str, Header(alias="X-Caller-Service")]) -> FileResponse:
    check_scope(caller, scope)
    if not re.fullmatch(r"[a-f0-9]{64}", key):
        raise RequestError("invalid object key")
    path = ObjectStore().get_path(bucket=get_settings().default_bucket, key=f"service-objects/canvas/{scope}/{key}")
    return FileResponse(path, media_type="application/octet-stream")
