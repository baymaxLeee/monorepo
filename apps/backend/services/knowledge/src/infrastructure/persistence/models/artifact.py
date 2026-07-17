"""Durable artifact generation task record + block storage metadata."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from infrastructure.persistence.models.base import Base


class ArtifactGenerationRow(Base):
    __tablename__ = "artifact_generations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    conversation_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    brief: Mapped[str] = mapped_column(Text, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    manifest_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    total_blocks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_blocks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_blocks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ArtifactBlockVersionRow(Base):
    __tablename__ = "artifact_block_versions"
    __table_args__ = (UniqueConstraint("generation_id", "block_id", name="ux_artifact_block_generation_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    generation_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    block_id: Mapped[str] = mapped_column(String(80), nullable=False)
    block_type: Mapped[str] = mapped_column(String(40), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    object_bucket: Mapped[str | None] = mapped_column(String(64), nullable=True)
    object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    object_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
