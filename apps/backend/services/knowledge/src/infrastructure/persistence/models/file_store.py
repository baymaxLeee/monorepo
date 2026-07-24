"""Current virtual files and per-deliverable staged mutations."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from infrastructure.persistence.models.base import Base


class FileEntryRow(Base):
    __tablename__ = "file_entries"
    __table_args__ = (UniqueConstraint("user_id", "conversation_id", "path", name="ux_file_entry_root_path"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    org_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    conversation_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    writable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    derived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class FileChangeSetRow(Base):
    __tablename__ = "file_change_sets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    org_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    conversation_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    baseline_sha256: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class FileChangeSetEntryRow(Base):
    __tablename__ = "file_change_set_entries"
    __table_args__ = (UniqueConstraint("change_set_id", "path", name="ux_file_change_set_path"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    change_set_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    writable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    derived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
