"""Internal contracts used by chat's durable artifact workflow."""

from typing import Any, Literal

from pydantic import BaseModel, Field

ArtifactMode = Literal["document", "presentation", "dashboard"]


class ReserveArtifactGenerationInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    org_id: str = Field(min_length=1, max_length=26)
    conversation_id: str | None = Field(default=None, max_length=32)
    title: str = Field(min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=160)
    mode: ArtifactMode = "document"
    brief: str = Field(min_length=1, max_length=20_000)
    idempotency_key: str = Field(min_length=1, max_length=128)
    document_id: str | None = Field(default=None, max_length=32)
    base_revision_id: str | None = Field(default=None, max_length=32)


class FailArtifactGenerationInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    error: str | None = Field(default=None, max_length=4000)


class CancelArtifactGenerationInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)


class ArtifactBlockPlan(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]+$", min_length=1, max_length=80)
    type: str = Field(min_length=1, max_length=40)
    source_version_id: str | None = Field(default=None, max_length=32)


class SaveArtifactPlanInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    manifest: dict[str, Any]
    blocks: list[ArtifactBlockPlan] = Field(min_length=1, max_length=200)


class SaveArtifactBlockInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    content: str = Field(min_length=1)
    failed: bool = False


class PublishArtifactRevisionInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    org_id: str = Field(min_length=1, max_length=26)
    compiled_html: str = Field(min_length=1)
    expected_object_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class ArtifactGeneration(BaseModel):
    id: str
    document_id: str
    status: str
    total_blocks: int
    completed_blocks: int
    failed_blocks: int
    error: str | None
    finished_at: str | None


class PublishedArtifactRevision(BaseModel):
    document_id: str
    revision_id: str
    title: str
    filename: str
    mime_type: str = "text/html"
    total_chars: int


class StoredArtifactBlock(BaseModel):
    id: str
    version_id: str
    type: str
    position: int
    content_sha256: str
    content: str


class ArtifactRevisionWorkspace(BaseModel):
    document_id: str
    revision_id: str
    manifest: dict[str, Any]
    blocks: list[StoredArtifactBlock]
