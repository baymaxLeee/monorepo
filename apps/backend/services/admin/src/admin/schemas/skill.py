"""Skill API schemas.

Field shape follows the Agent Skills spec: `name` (kebab-case, doubles as the
model-facing invocation name), `description` (when to use it), and the SKILL.md
`body`. Management fields (status/is_enabled) are ours, not part of the spec.
"""

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

SkillStatus = Literal["draft", "active", "disabled"]

# Agent Skills spec: lowercase letters, digits, hyphens; must start with a
# letter and not end with a hyphen. Doubles as the load_skill invocation name.
_NAME_RE = re.compile(r"^[a-z][a-z0-9-]*[a-z0-9]$")

_ALLOWED_CONTROL = {"\n", "\t"}


def _reject_control_chars(value: str) -> str:
    if any(ord(ch) < 0x20 and ch not in _ALLOWED_CONTROL for ch in value):
        raise ValueError("control characters are not allowed")
    return value


def _validate_name(value: str) -> str:
    if not _NAME_RE.fullmatch(value):
        raise ValueError(
            "name must be kebab-case: lowercase letters, digits and hyphens, starting with a letter (e.g. 'oncall-rca')"
        )
    return value


class SkillSummary(BaseModel):
    """L1 list view: everything except the L2 `body`. Used by every listing
    surface (the skills table and a bot's bound skills) so the browser never
    downloads skill bodies in bulk — the body is fetched only when editing a
    single skill (`GET /skills/{id}`) or when a skill is actually loaded."""

    id: str
    user_id: str
    org_id: str
    username: str
    name: str
    description: str
    status: SkillStatus
    is_enabled: bool
    created_at: str
    updated_at: str


class Skill(SkillSummary):
    body: str


class AgentSkill(BaseModel):
    """L1 discovery view carried on ResolvedAgent — name + description only, no
    body. Chat advertises these in `<available_skills>` and pulls the body via
    `/internal/skills/{id}` only when `load_skill` fires."""

    id: str
    name: str
    description: str


class InternalSkill(BaseModel):
    """Internal (service-to-service) view including the full body."""

    id: str
    name: str
    description: str
    body: str


class CreateSkillInput(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=1024)
    body: str = Field(default="", max_length=20000)
    status: SkillStatus = "draft"
    is_enabled: bool = True

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _validate_name(value)

    @field_validator("description", "body")
    @classmethod
    def _clean_text(cls, value: str) -> str:
        return _reject_control_chars(value)


class UpdateSkillInput(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=1024)
    body: str | None = Field(default=None, max_length=20000)
    status: SkillStatus | None = None
    is_enabled: bool | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str | None) -> str | None:
        return None if value is None else _validate_name(value)

    @field_validator("description", "body")
    @classmethod
    def _clean_text(cls, value: str | None) -> str | None:
        return None if value is None else _reject_control_chars(value)


class AttachSkillInput(BaseModel):
    skill_id: str = Field(min_length=1, max_length=32)


class BulkDeleteSkillsInput(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=100)


class BulkDeleteSkillsResult(BaseModel):
    deleted: int
