"""Document API schemas."""

from typing import Literal

from pydantic import BaseModel, Field

DocumentKind = Literal["source", "artifact"]
IngestStatus = Literal["pending", "storing", "received", "converting", "ready", "failed"]
IndexStatus = Literal["pending", "indexing", "indexed", "skipped", "failed"]


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
    editable_source: bool = False
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


class SourceUploadIntentInput(BaseModel):
    client_ref: str = Field(min_length=1, max_length=128)
    filename: str = Field(min_length=1, max_length=255)
    media_type: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(ge=0)


class PrepareSourceUploadsInput(BaseModel):
    files: list[SourceUploadIntentInput] = Field(min_length=1, max_length=100)
    conversation_id: str | None = Field(default=None, max_length=32)


class SourceUploadPlan(BaseModel):
    client_ref: str
    upload_session_id: str
    intent_id: str
    state: Literal["pending", "uploading", "completed", "failed", "aborted"]
    upload_url: str
    expires_at: str
    asset_id: str | None = None
    revision_id: str | None = None


class PrepareSourceUploadsResult(BaseModel):
    uploads: list[SourceUploadPlan]


class SourceUploadCompletion(BaseModel):
    client_ref: str = Field(min_length=1, max_length=128)
    upload_session_id: str = Field(min_length=36, max_length=36)


class CreateSourceDocumentsInput(BaseModel):
    uploads: list[SourceUploadCompletion] = Field(min_length=1, max_length=100)
    conversation_id: str | None = Field(default=None, max_length=32)
    provider_id: str | None = Field(default=None, max_length=32)
