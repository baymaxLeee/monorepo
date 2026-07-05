"""Document API schemas."""

from typing import Literal

from pydantic import BaseModel, Field

DocumentKind = Literal["source", "artifact"]
IngestStatus = Literal["pending", "storing", "converting", "ready", "failed"]


class Document(BaseModel):
    id: str
    user_id: str
    org_id: str | None = None
    conversation_id: str | None = None
    kind: DocumentKind
    title: str
    filename: str
    mime_type: str
    content_md: str = ""
    source_size: int = 0
    source_mime_type: str | None = None
    object_bucket: str | None = None
    object_key: str | None = None
    object_sha256: str | None = None
    source_filename: str | None = None
    ingest_status: IngestStatus = "ready"
    ingest_progress: int = 100
    ingest_error: str | None = None
    created_at: str
    updated_at: str


class CreateArtifactInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
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
    """Persist agent-generated binary media (image/video/audio) as a document.

    The bytes are copied into the object store and served back via the existing
    ``/documents/{id}/source`` route. Callers must never persist a provider's
    temporary URL as the durable source of truth (ADR-0014)."""

    user_id: str = Field(min_length=1, max_length=26)
    conversation_id: str | None = Field(default=None, max_length=32)
    title: str = Field(min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=160)
    mime_type: str = Field(min_length=1, max_length=120)
    data_base64: str = Field(min_length=1)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)


class DocumentSlice(BaseModel):
    id: str
    title: str
    filename: str
    mime_type: str
    content: str
    start: int = 0
    total_chars: int
    next_start: int | None = None
