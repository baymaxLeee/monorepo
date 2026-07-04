"""Bot (智能体/agent) API schemas."""

from typing import Literal

from pydantic import BaseModel, Field

from admin.schemas.provider import InternalModelProvider

BotStatus = Literal["draft", "published", "archived"]


class Bot(BaseModel):
    id: str
    user_id: str
    username: str
    name: str
    status: BotStatus
    text_provider_id: str | None = None
    image_provider_id: str | None = None
    video_provider_id: str | None = None
    created_at: str
    updated_at: str


class CreateBotInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class UpdateBotInput(BaseModel):
    """Partial update. Only fields present in the request are applied; a field
    sent as null clears it (e.g. unassigning a model provider)."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    status: BotStatus | None = None
    text_provider_id: str | None = Field(default=None, max_length=32)
    image_provider_id: str | None = Field(default=None, max_length=32)
    video_provider_id: str | None = Field(default=None, max_length=32)


class ResolvedAgent(BaseModel):
    """An agent with its per-capability model providers fully resolved to
    (decrypted) provider snapshots. Internal-only: chat resolves this once per
    run and passes providers through — never re-fetching inside tools/steps.
    A capability is null when the agent has not configured it (or it was
    disabled/removed)."""

    id: str
    name: str
    text_provider: InternalModelProvider | None = None
    image_provider: InternalModelProvider | None = None
    video_provider: InternalModelProvider | None = None
