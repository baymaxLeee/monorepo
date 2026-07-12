"""Skill package API contracts."""

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

SkillStatus = Literal["draft", "published", "archived"]
NodeType = Literal["file", "directory"]
ChangeAction = Literal["create", "update", "delete", "move", "rename"]

_NAME_RE = re.compile(r"^[a-z](?:[a-z0-9]|-(?=[a-z0-9]))*[a-z0-9]$|^[a-z]$")


def _validate_name(value: str) -> str:
    if not _NAME_RE.fullmatch(value):
        raise ValueError("name must use lowercase letters, digits and single hyphens")
    return value


class SkillSummary(BaseModel):
    id: str
    user_id: str
    org_id: str
    username: str
    name: str
    description: str
    status: SkillStatus
    is_enabled: bool
    has_unpublished_changes: bool
    published_at: str | None
    created_at: str
    updated_at: str


class Skill(SkillSummary):
    workspace_seq: int


class AgentSkill(BaseModel):
    id: str
    name: str
    description: str


class InternalSkill(BaseModel):
    id: str
    name: str
    description: str
    body: str
    files: list[str]


class InternalSkillFile(BaseModel):
    path: str
    content: str


class CreateSkillInput(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=1024)

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _validate_name(value)


class UpdateSkillInput(BaseModel):
    is_enabled: bool | None = None
    status: Literal["draft", "archived"] | None = None


class SkillFileNode(BaseModel):
    id: str
    name: str
    type: NodeType
    parent_id: str | None = None
    mime_type: str | None = None
    content: str | None = None
    children: list[SkillFileNode] | None = None


class SkillWorkspace(BaseModel):
    skill_id: str
    workspace_seq: int
    tree: list[SkillFileNode]


class SkillFileContent(BaseModel):
    id: str
    content: str


class SkillFileChange(BaseModel):
    action: ChangeAction
    id: str = Field(min_length=1, max_length=64)
    parent_id: str | None = None
    name: str | None = Field(default=None, max_length=255)
    type: NodeType | None = None
    content: str | None = Field(default=None, max_length=200_000)


class UpdateSkillWorkspaceInput(BaseModel):
    base_workspace_seq: int = Field(ge=1)
    changes: list[SkillFileChange] = Field(min_length=1, max_length=200)


class PublishSkillInput(BaseModel):
    base_workspace_seq: int = Field(ge=1)


class SkillValidationIssue(BaseModel):
    path: str
    message: str


class SkillValidationResult(BaseModel):
    ok: bool
    issues: list[SkillValidationIssue]


class PublishSkillResult(BaseModel):
    skill: Skill
    validation: SkillValidationResult


class AttachSkillInput(BaseModel):
    skill_id: str = Field(min_length=1, max_length=32)


class BulkDeleteSkillsInput(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=100)


class BulkDeleteSkillsResult(BaseModel):
    deleted: int
