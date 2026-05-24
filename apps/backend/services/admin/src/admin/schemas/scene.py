"""Scene API schemas."""

from typing import Literal

from pydantic import BaseModel, Field

SceneStatus = Literal["draft", "active", "disabled"]


class Scene(BaseModel):
    id: str
    user_id: str
    username: str
    name: str
    description: str
    status: SceneStatus
    is_enabled: bool
    created_at: str
    updated_at: str


class CreateSceneInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    status: SceneStatus = "draft"
    is_enabled: bool = True


class UpdateSceneInput(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    status: SceneStatus | None = None
    is_enabled: bool | None = None


class BulkDeleteScenesInput(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=100)


class BulkDeleteScenesResult(BaseModel):
    deleted: int
