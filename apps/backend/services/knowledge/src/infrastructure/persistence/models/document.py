"""Document ORM model."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from infrastructure.persistence.models.base import Base


class DocumentRow(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    org_id: Mapped[str | None] = mapped_column(String(26), index=True, nullable=True)
    conversation_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False, default="text/markdown")
    content_md: Mapped[str] = mapped_column(Text, nullable=False)
    source_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    object_bucket: Mapped[str | None] = mapped_column(String(64), nullable=True)
    object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    object_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    current_revision_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ingest_status: Mapped[str] = mapped_column(String(20), nullable=False, default="ready")
    ingest_progress: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    ingest_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    index_status: Mapped[str] = mapped_column(String(20), nullable=False, default="skipped")
    index_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
