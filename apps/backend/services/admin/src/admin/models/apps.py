"""App registry ORM model.

The app registry is the operator-managed catalog of micro-frontends the
platform shell may mount. Unlike bots/scenes/intentions it is NOT user-owned —
it is global configuration (admin config plane), so there is no `user_id`.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class AppRow(Base):
    __tablename__ = "apps"

    # Slug primary key (e.g. "admin", "chat"); used as the URL segment.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    base_path: Mapped[str] = mapped_column(String(200), nullable=False)
    remote_name: Mapped[str] = mapped_column(String(120), nullable=False)
    expose_key: Mapped[str] = mapped_column(String(120), nullable=False, default="./App")
    entry: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # When true the app is only visible to admin users; when false it is also
    # rendered for normal users. This is the lever operators flip per app.
    requires_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
