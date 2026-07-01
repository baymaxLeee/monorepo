"""Internal contracts used by chat's durable artifact workflow."""

from typing import Any, Literal

from pydantic import BaseModel, Field

ArtifactMode = Literal["document", "presentation", "dashboard"]


class ReserveArtifactGenerationInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    conversation_id: str | None = Field(default=None, max_length=32)
    title: str = Field(min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=160)
    mode: ArtifactMode = "document"
    brief: str = Field(min_length=1, max_length=20_000)
    idempotency_key: str = Field(min_length=1, max_length=128)
    base_revision_id: str | None = Field(default=None, max_length=32)
    document_id: str | None = Field(default=None, max_length=32)
    run_id: str | None = Field(default=None, max_length=32)
    tool_call_id: str | None = Field(default=None, max_length=64)


class ArtifactMutationInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    owner: str | None = Field(default=None, max_length=128)
    error: str | None = Field(default=None, max_length=4000)


class ArtifactBlockPlan(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]+$", min_length=1, max_length=80)
    type: str = Field(min_length=1, max_length=40)
    brief: str = Field(min_length=1, max_length=4000)


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
    compiled_html: str = Field(min_length=1)


class ArtifactGeneration(BaseModel):
    id: str
    document_id: str
    status: str
    phase: str
    total_blocks: int
    completed_blocks: int
    failed_blocks: int
    error: str | None
    attempt: int
    run_id: str | None
    tool_call_id: str | None
    lease_owner: str | None
    lease_expires_at: str | None
    started_at: str | None
    finished_at: str | None
    cancel_requested_at: str | None


class ArtifactGenerationDetail(ArtifactGeneration):
    user_id: str
    title: str
    filename: str
    brief: str
    manifest: dict[str, Any] | None = None


class PublishedArtifactRevision(BaseModel):
    document_id: str
    revision_id: str
    title: str
    filename: str
    mime_type: str = "text/html"
    total_chars: int


class StoredArtifactBlock(BaseModel):
    id: str
    type: str
    position: int
    content: str


class ArtifactRevisionWorkspace(BaseModel):
    document_id: str
    revision_id: str
    manifest: dict[str, Any]
    blocks: list[StoredArtifactBlock]
