"""Document API schemas."""

from typing import Literal

from pydantic import BaseModel, Field

DocumentKind = Literal["source", "artifact"]
IngestStatus = Literal["pending", "storing", "converting", "ready", "failed"]


class Document(BaseModel):
    id: str
    user_id: str
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


class DocumentSlice(BaseModel):
    id: str
    title: str
    filename: str
    mime_type: str
    content: str
    start: int = 0
    total_chars: int
    next_start: int | None = None
