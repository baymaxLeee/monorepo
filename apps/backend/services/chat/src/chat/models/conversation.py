"""Conversation ORM model."""

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ConversationRow(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="新对话")
    model: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # Opaque FK into `admin.model_providers.id`. We never join across
    # services — chat just remembers which provider the user last pinned to
    # this conversation so that follow-up messages stay consistent.
    provider_id: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
