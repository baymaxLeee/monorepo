from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from infrastructure.persistence.models.base import Base


class CanvasSettingsRow(Base):
    __tablename__ = "canvas_settings"
    workspace_id: Mapped[str] = mapped_column(String(26), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(26))
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    defaults_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[str] = mapped_column(String(26), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
