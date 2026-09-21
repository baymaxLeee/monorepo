"""Public delivery for signed immutable artifact capabilities."""

from application.artifact_urls import valid_artifact_identity, valid_content_type, verify_artifact_url
from application.object_store import ObjectStore
from bootstrap.config import get_settings
from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from kernel.errors import RequestError, UnauthorizedError

router = APIRouter(prefix="/media/artifacts", tags=["artifact-media"])


@router.get("/{namespace}/{artifact_id}", include_in_schema=False)
def get_artifact_media(
    namespace: str,
    artifact_id: str,
    expires: int = Query(gt=0),
    content_type: str = Query(min_length=3, max_length=129),
    signature: str = Query(min_length=64, max_length=64),
) -> FileResponse:
    if not valid_artifact_identity(namespace, artifact_id) or not valid_content_type(content_type):
        raise RequestError("invalid artifact capability")
    if not verify_artifact_url(
        namespace=namespace,
        artifact_id=artifact_id,
        content_type=content_type,
        expires=expires,
        signature=signature,
    ):
        raise UnauthorizedError("invalid or expired artifact capability")
    path = ObjectStore().get_path(
        bucket=get_settings().default_bucket,
        key=f"service-objects/canvas/{namespace}/{artifact_id}",
    )
    return FileResponse(path, media_type=content_type)
