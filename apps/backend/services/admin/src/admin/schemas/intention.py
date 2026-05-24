"""Intention API schemas."""

from typing import Literal

from pydantic import BaseModel, Field

IntentionStatus = Literal["draft", "active", "disabled"]


class Intention(BaseModel):
    id: str
    user_id: str
    username: str
    name: str
    description: str
    scene_name: str
    examples: int
    status: IntentionStatus
    is_enabled: bool
    created_at: str
    updated_at: str


class CreateIntentionInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    scene_name: str = Field(default="", max_length=100)
    examples: int = Field(default=0, ge=0)
    status: IntentionStatus = "draft"
    is_enabled: bool = True


class UpdateIntentionInput(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    scene_name: str | None = Field(default=None, max_length=100)
    examples: int | None = Field(default=None, ge=0)
    status: IntentionStatus | None = None
    is_enabled: bool | None = None


class BulkDeleteIntentionsInput(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=100)


class BulkDeleteIntentionsResult(BaseModel):
    deleted: int
