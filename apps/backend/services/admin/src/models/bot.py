"""Bot (智能体/agent) ORM model."""

from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class BotRow(Base):
    __tablename__ = "bots"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    org_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    domain_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    audience: Mapped[str | None] = mapped_column(String(200), nullable=True)
    tone: Mapped[str] = mapped_column(String(20), nullable=False, default="professional")
    welcome_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggested_questions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    text_provider_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    image_provider_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    video_provider_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
