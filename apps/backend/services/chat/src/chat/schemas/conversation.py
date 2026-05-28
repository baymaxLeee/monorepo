"""Conversation / Message API schemas."""

from typing import Literal

from pydantic import BaseModel, Field

MessageRole = Literal["user", "assistant", "system"]
MessageStatus = Literal["ok", "streaming", "failed"]
ReasoningEffort = Literal["low", "medium", "high"]


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


class CreateConversationInput(BaseModel):
    title: str = Field(default="新对话", min_length=1, max_length=200)
    # Optional: if omitted, the user's default model provider is used the
    # first time a message is sent.
    provider_id: str | None = Field(default=None, max_length=32)


class UpdateConversationInput(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)


class SendMessageInput(BaseModel):
    content: str = Field(min_length=1, max_length=8000)

    # Optional pinning of the model provider for this message. When omitted,
    # the message inherits the conversation's `model` field (if previously
    # set) or falls back to the user's default provider.
    provider_id: str | None = Field(
        default=None,
        max_length=32,
        description="Override the model provider for this message only.",
    )

    # Vendor-extension knobs (currently DeepSeek V4 / Anthropic-style
    # reasoning). Forwarded to the OpenAI-compatible endpoint via `extra_body`;
    # providers that don't understand them ignore the keys silently.
    thinking: bool | None = Field(
        default=None,
        description="Enable chain-of-thought reasoning when the model supports it.",
    )
    reasoning_effort: ReasoningEffort | None = Field(
        default=None,
        description="Reasoning compute budget for thinking-enabled models.",
    )
