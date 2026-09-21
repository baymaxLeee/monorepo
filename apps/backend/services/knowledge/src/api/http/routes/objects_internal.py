"""Immutable service-owned objects; lifecycle remains with the owning service."""

import re
from typing import Annotated

from application.object_store import ObjectStore
from bootstrap.config import get_settings
from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import FileResponse
from kernel.errors import RequestError, UnauthorizedError
from pydantic import BaseModel

from api.http.dependencies import require_internal_token

router = APIRouter(prefix="/internal/objects", tags=["service-objects"], dependencies=[Depends(require_internal_token)])


class StoredServiceObject(BaseModel):
    artifact_id: str
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
    stored = await ObjectStore().put_content_stream(
        chunks=request.stream(),
        user_id=scope,
        prefix="service-objects/canvas",
        max_bytes=get_settings().media_max_object_bytes,
    )
    return StoredServiceObject(artifact_id=stored.sha256, size=stored.size, sha256=stored.sha256)


@router.get("/{scope}/{artifact_id}")
def get_object(scope: str, artifact_id: str, caller: Annotated[str, Header(alias="X-Caller-Service")]) -> FileResponse:
    check_scope(caller, scope)
    if not re.fullmatch(r"[a-f0-9]{64}", artifact_id):
        raise RequestError("invalid artifact ID")
    path = ObjectStore().get_path(
        bucket=get_settings().default_bucket, key=f"service-objects/canvas/{scope}/{artifact_id}"
    )
    return FileResponse(path, media_type="application/octet-stream")


@router.delete("/{scope}/{artifact_id}", status_code=204)
def delete_object(scope: str, artifact_id: str, caller: Annotated[str, Header(alias="X-Caller-Service")]) -> Response:
    check_scope(caller, scope)
    if not re.fullmatch(r"[a-f0-9]{64}", artifact_id):
        raise RequestError("invalid artifact ID")
    ObjectStore().delete(bucket=get_settings().default_bucket, key=f"service-objects/canvas/{scope}/{artifact_id}")
    return Response(status_code=204)
