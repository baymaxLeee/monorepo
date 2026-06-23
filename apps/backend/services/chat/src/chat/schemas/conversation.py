"""Conversation / Message API schemas."""

from typing import Literal

from pydantic import BaseModel, Field

from chat.schemas.document import ConversationDocument

MessageRole = Literal["user", "assistant", "system"]
MessageStatus = Literal["ok", "streaming", "failed"]


class Message(BaseModel):
    id: str
    conversation_id: str
    role: MessageRole
    content: str
    status: MessageStatus
    created_at: str


class Conversation(BaseModel):
    id: str
    user_id: str
    title: str
    model: str
    provider_id: str
    created_at: str
    updated_at: str


class ConversationDetail(Conversation):
    messages: list[Message] = []
    documents: list[ConversationDocument] = []


class CreateConversationInput(BaseModel):
    title: str = Field(default="新对话", min_length=1, max_length=200)
    # Optional: if omitted, the user's default model provider is used the
    # first time a message is sent.
    provider_id: str | None = Field(default=None, max_length=32)


class UpdateConversationInput(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
