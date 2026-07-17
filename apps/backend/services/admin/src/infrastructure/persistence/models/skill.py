"""Skill ORM model.

A Skill is a code-of-conduct / workflow that a Bot can advertise to the model.
Storage is the single source of truth for the L1 discovery fields (name,
description) and the L2 body (SKILL.md content), following the Agent Skills
progressive-disclosure model: only name/description enter the prompt at start,
the full body is pulled on demand via the chat `load_skill` tool.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from infrastructure.persistence.models.base import Base


class SkillRow(Base):
    __tablename__ = "skills"
    __table_args__ = (UniqueConstraint("org_id", "name", name="ux_skills_org_name"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    org_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(120), nullable=False)
    # kebab-case, doubles as the model-facing invocation name (Agent Skills spec).
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    workspace_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    workspace_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    published_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    published_description: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
