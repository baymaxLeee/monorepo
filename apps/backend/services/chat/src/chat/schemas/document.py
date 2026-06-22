"""Conversation document API schemas."""

from typing import Literal

from pydantic import BaseModel, Field

DocumentKind = Literal["source", "artifact"]


class ConversationDocument(BaseModel):
    id: str
    conversation_id: str
    kind: DocumentKind
    title: str
    filename: str
    mime_type: str
    source_size: int
    created_at: str
    updated_at: str


class ConversationDocumentDetail(ConversationDocument):
    content_md: str


class UpdateConversationDocumentInput(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content_md: str | None = Field(default=None, min_length=1)
