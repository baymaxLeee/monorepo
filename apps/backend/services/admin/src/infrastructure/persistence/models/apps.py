"""App registry ORM model.

The app registry is the operator-managed catalog of micro-frontends the
platform shell may mount. Unlike team-owned resources it is NOT user-owned —
it is global configuration (admin config plane), so there is no `user_id`.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from infrastructure.persistence.models.base import Base


class AppRow(Base):
    __tablename__ = "apps"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    base_path: Mapped[str] = mapped_column(String(200), nullable=False)
    remote_name: Mapped[str] = mapped_column(String(120), nullable=False)
    expose_key: Mapped[str] = mapped_column(String(120), nullable=False, default="./routes")
    entry: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    requires_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
