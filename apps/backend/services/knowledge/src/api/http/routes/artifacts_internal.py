"""Internal artifact capability minting for storage consumers."""

from application.artifact_urls import create_artifact_url, valid_artifact_identity, valid_content_type
from fastapi import APIRouter, Depends
from kernel.errors import RequestError
from pydantic import BaseModel, Field

from api.http.dependencies import require_internal_token

router = APIRouter(
    prefix="/internal/artifacts", tags=["service-artifacts"], dependencies=[Depends(require_internal_token)]
)


class ArtifactURLRequest(BaseModel):
    namespace: str
    artifact_id: str
    content_type: str


class BatchArtifactURLRequest(BaseModel):
    items: list[ArtifactURLRequest] = Field(max_length=200)


class PresignedArtifact(BaseModel):
    namespace: str
    artifact_id: str
    url: str
    expires_at: str


class BatchArtifactURLResponse(BaseModel):
    items: list[PresignedArtifact]


@router.post("/presign", response_model=BatchArtifactURLResponse)
async def batch_presign(payload: BatchArtifactURLRequest) -> BatchArtifactURLResponse:
    if not payload.items:
        return BatchArtifactURLResponse(items=[])
    if not all(
        valid_artifact_identity(item.namespace, item.artifact_id) and valid_content_type(item.content_type)
        for item in payload.items
    ):
        raise RequestError("invalid artifact identity or content type")
    unique: dict[tuple[str, str, str], ArtifactURLRequest] = {
        (item.namespace, item.artifact_id, item.content_type): item for item in payload.items
    }
    results: list[PresignedArtifact] = []
    for item in unique.values():
        url, expires_at = await create_artifact_url(item.namespace, item.artifact_id, item.content_type)
        results.append(
            PresignedArtifact(
                namespace=item.namespace,
                artifact_id=item.artifact_id,
                url=url,
                expires_at=expires_at.isoformat(),
            )
        )
    return BatchArtifactURLResponse(items=results)
