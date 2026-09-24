"""Skill package API contracts."""

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

SkillStatus = Literal["draft", "published", "archived"]
NodeType = Literal["file", "directory"]
SkillStorageKind = Literal["inline", "asset"]
_NAME_RE = re.compile("^[a-z](?:[a-z0-9]|-(?=[a-z0-9]))*[a-z0-9]$|^[a-z]$")


def _validate_name(value: str) -> str:
    if not _NAME_RE.fullmatch(value):
        raise ValueError("name must use lowercase letters, digits and single hyphens")
    return value


class SkillSummary(BaseModel):
    id: str
    user_id: str
    workspace_id: str
    tenant_id: str
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
    storage_kind: SkillStorageKind
    mime_type: str | None = None
    content: str | None = None
    asset_id: str | None = None
    revision_id: str | None = None
    size_bytes: int | None = None
    sha256: str | None = None
    url: str | None = None


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
    storage_kind: SkillStorageKind = "inline"
    asset_id: str | None = None
    revision_id: str | None = None
    size_bytes: int | None = None
    sha256: str | None = None
    etag: str
    content: str | None = None
    children: list[SkillFileNode] | None = None


class SkillWorkspace(BaseModel):
    skill_id: str
    workspace_seq: int
    tree: list[SkillFileNode]


class SkillFileContent(BaseModel):
    id: str
    storage_kind: SkillStorageKind
    mime_type: str | None = None
    content: str | None = None
    asset_id: str | None = None
    revision_id: str | None = None
    size_bytes: int | None = None
    sha256: str | None = None
    url: str | None = None
    etag: str


class AttachSkillAssetInput(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    client_ref: str = Field(min_length=1, max_length=64)
    parent_id: str | None = None
    name: str = Field(min_length=1, max_length=255)
    upload_session_id: str = Field(min_length=36, max_length=36)


class ImportSkillArchiveInput(BaseModel):
    client_ref: str = Field(min_length=1, max_length=64)
    upload_session_id: str = Field(min_length=36, max_length=36)
    base_workspace_seq: int = Field(ge=1)


class PrepareSkillUploadInput(BaseModel):
    client_ref: str = Field(min_length=1, max_length=64)
    purpose: Literal["skill-archive", "skill-attachment"]
    filename: str = Field(min_length=1, max_length=255)
    media_type: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(ge=0)


class SkillUploadPlan(BaseModel):
    upload_session_id: str
    intent_id: str
    state: Literal["pending", "uploading", "completed", "failed", "aborted"]
    upload_url: str
    expires_at: str
    asset_id: str | None = None
    revision_id: str | None = None


class ImportSkillArchiveResult(BaseModel):
    skill: Skill
    workspace: SkillWorkspace
    imported_files: int
    imported_asset_files: int


class CreateSkillNodeInput(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    parent_id: str | None = None
    name: str = Field(min_length=1, max_length=255)
    type: NodeType
    content: str | None = Field(default=None, max_length=200000)


class UpdateSkillFileContentInput(BaseModel):
    base_etag: str = Field(min_length=64, max_length=64)
    content: str = Field(max_length=200000)


class RenameSkillNodeInput(BaseModel):
    base_etag: str = Field(min_length=64, max_length=64)
    name: str = Field(min_length=1, max_length=255)


class MoveSkillNodeInput(BaseModel):
    base_etag: str = Field(min_length=64, max_length=64)
    parent_id: str | None = None


class SkillNodeMutationResult(BaseModel):
    workspace_seq: int
    node_id: str
    etag: str | None = None


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
