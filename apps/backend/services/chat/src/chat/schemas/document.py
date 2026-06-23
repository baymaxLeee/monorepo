"""Conversation document API schemas."""

from typing import Literal

from pydantic import BaseModel, Field

DocumentKind = Literal["source", "artifact"]
IngestStatus = Literal["pending", "queued", "storing", "converting", "ready", "failed"]


class ConversationDocument(BaseModel):
    id: str
    conversation_id: str
    kind: DocumentKind
    title: str
    filename: str
    mime_type: str
    source_size: int
    source_mime_type: str | None = None
    source_object_bucket: str | None = None
    source_object_key: str | None = None
    source_sha256: str | None = None
    source_filename: str | None = None
    ingest_status: IngestStatus = "ready"
    ingest_progress: int = 100
    ingest_error: str | None = None
    created_at: str
    updated_at: str


class ConversationDocumentDetail(ConversationDocument):
    content_md: str


class UpdateConversationDocumentInput(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content_md: str | None = Field(default=None, min_length=1)
