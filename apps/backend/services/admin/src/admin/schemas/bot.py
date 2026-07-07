"""Bot (智能体/agent) API schemas."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from admin.schemas.provider import InternalModelProvider
from admin.schemas.skill import AgentSkill

BotStatus = Literal["draft", "published", "archived"]
BotTone = Literal["professional", "concise", "friendly", "empathetic"]

# C0 control chars are never legitimate profile content; tab/newline are kept so
# multi-line role/domain text survives.
_ALLOWED_CONTROL = {"\n", "\t"}


def _reject_control_chars(value: str) -> str:
    if any(ord(ch) < 0x20 and ch not in _ALLOWED_CONTROL for ch in value):
        raise ValueError("control characters are not allowed")
    return value


class Bot(BaseModel):
    id: str
    user_id: str
    org_id: str
    username: str
    name: str
    role_description: str | None = None
    domain_description: str | None = None
    audience: str | None = None
    tone: BotTone = "professional"
    welcome_message: str | None = None
    suggested_questions: list[str] = Field(default_factory=list)
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
    role_description: str | None = Field(default=None, max_length=2000)
    domain_description: str | None = Field(default=None, max_length=2000)
    audience: str | None = Field(default=None, max_length=200)
    tone: BotTone | None = None
    welcome_message: str | None = Field(default=None, max_length=1000)
    suggested_questions: list[str] | None = Field(default=None, max_length=6)
    status: BotStatus | None = None
    text_provider_id: str | None = Field(default=None, max_length=32)
    image_provider_id: str | None = Field(default=None, max_length=32)
    video_provider_id: str | None = Field(default=None, max_length=32)

    @field_validator("role_description", "domain_description", "audience", "welcome_message")
    @classmethod
    def _clean_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _reject_control_chars(value)

    @field_validator("suggested_questions")
    @classmethod
    def _clean_questions(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        for item in value:
            trimmed = item.strip()
            if not trimmed:
                raise ValueError("suggested question must not be empty")
            if len(trimmed) > 200:
                raise ValueError("suggested question must be at most 200 characters")
            cleaned.append(_reject_control_chars(trimmed))
        return cleaned


class ResolvedAgent(BaseModel):
    """An agent with its per-capability model providers fully resolved to
    (decrypted) provider snapshots. Internal-only: chat resolves this once per
    run and passes providers through — never re-fetching inside tools/steps.
    A capability is null when the agent has not configured it (or it was
    disabled/removed).

    Carries only the structured identity fields the model actually needs;
    welcome_message / suggested_questions are UI-only and deliberately excluded
    so bot presentation copy never enters the model context."""

    id: str
    name: str
    role_description: str | None = None
    domain_description: str | None = None
    audience: str | None = None
    tone: BotTone = "professional"
    text_provider: InternalModelProvider | None = None
    image_provider: InternalModelProvider | None = None
    video_provider: InternalModelProvider | None = None
    skills: list[AgentSkill] = Field(default_factory=list)
