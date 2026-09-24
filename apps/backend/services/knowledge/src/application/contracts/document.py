"""Document API schemas."""

from typing import Literal

from pydantic import BaseModel, Field

DocumentKind = Literal["source", "artifact"]
IngestStatus = Literal["pending", "storing", "received", "converting", "ready", "failed"]
IndexStatus = Literal["pending", "indexing", "indexed", "skipped", "failed"]
SliceState = Literal["ready", "processing", "failed"]


class Document(BaseModel):
    id: str
    user_id: str
    workspace_id: str | None = None
    tenant_id: str | None = None
    conversation_id: str | None = None
    kind: DocumentKind
    title: str
    filename: str
    mime_type: str
    content_md: str = ""
    source_size: int = 0
    source_mime_type: str | None = None
    asset_id: str | None = None
    source_revision_id: str | None = None
    source_sha256: str | None = None
    source_filename: str | None = None
    ingest_status: IngestStatus = "ready"
    ingest_progress: int = 100
    ingest_error: str | None = None
    index_status: IndexStatus = "skipped"
    index_error: str | None = None
    created_at: str
    updated_at: str


class IngestFailure(BaseModel):
    index: int
    client_ref: str
    artifact_id: str | None = None
    error: str
    code: str | None = None


class IngestReceipt(BaseModel):
    index: int
    client_ref: str
    document: Document


class IngestResult(BaseModel):
    documents: list[IngestReceipt]
    failed: list[IngestFailure] = Field(default_factory=list)


class AssetIngestItem(BaseModel):
    client_ref: str = Field(min_length=1, max_length=128)
    asset_id: str = Field(min_length=36, max_length=36)
    revision_id: str = Field(min_length=36, max_length=36)


class CreateSourceDocumentsInput(BaseModel):
    assets: list[AssetIngestItem] = Field(min_length=1, max_length=100)
    conversation_id: str | None = Field(default=None, max_length=32)
    provider_id: str | None = Field(default=None, max_length=32)


class CreateArtifactInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    workspace_id: str = Field(min_length=1, max_length=26)
    tenant_id: str = Field(min_length=1, max_length=26)
    conversation_id: str | None = Field(default=None, max_length=32)
    title: str = Field(min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1)
    mime_type: str | None = Field(default=None, max_length=120)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)


class UpdateArtifactInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    filename: str | None = Field(default=None, min_length=1, max_length=160)
    content: str | None = Field(default=None, min_length=1)
    mime_type: str | None = Field(default=None, max_length=120)
    expected_updated_at: str | None = Field(default=None, min_length=1, max_length=64)


class CreateMediaDocumentInput(BaseModel):
    """Register an agent-generated immutable Asset revision as a document."""

    user_id: str = Field(min_length=1, max_length=26)
    workspace_id: str = Field(min_length=1, max_length=26)
    tenant_id: str = Field(min_length=1, max_length=26)
    conversation_id: str | None = Field(default=None, max_length=32)
    title: str = Field(min_length=1, max_length=120)
    asset_id: str = Field(min_length=36, max_length=36)
    revision_id: str = Field(min_length=36, max_length=36)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)


class CreateStagedMediaInput(CreateMediaDocumentInput):
    pass


class StagedMedia(BaseModel):
    id: str
    user_id: str
    workspace_id: str
    tenant_id: str
    conversation_id: str | None = None
    title: str
    filename: str
    mime_type: str
    size: int
    asset_id: str
    revision_id: str
    sha256: str
    status: Literal["staged", "published", "discarded"]
    document_id: str | None = None
    created_at: str
    updated_at: str


class StagedMediaActionInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    workspace_id: str = Field(min_length=1, max_length=26)
    tenant_id: str = Field(min_length=1, max_length=26)


class DocumentSlice(BaseModel):
    id: str
    title: str
    filename: str
    mime_type: str
    content: str
    start: int = 0
    total_chars: int
    next_start: int | None = None
    state: SliceState = "ready"
    error: str | None = None
