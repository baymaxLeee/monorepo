"""Durable guard against late writes for deleted conversations."""

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from infrastructure.persistence.models.base import Base


class ConversationArtifactTombstoneRow(Base):
    __tablename__ = "conversation_artifact_tombstones"

    conversation_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    org_id: Mapped[str] = mapped_column(String(26), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

