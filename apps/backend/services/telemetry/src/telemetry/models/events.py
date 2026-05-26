"""Telemetry event ORM models.

All event tables share the provenance columns defined in `EventCommonMixin`
(device/session/user metadata propagated from the gateway via `X-Auth-*`).
`id` is a server-side `BIGINT UNSIGNED AUTO_INCREMENT` so InnoDB has a
small, monotonically increasing clustered key — the actual time-range
queries hit the `(app, *, ts_server)` secondary indexes.

`payload` is MySQL JSON; SQLAlchemy serialises dict ↔ JSON for us.

`SessionRow` uses `(app, session_id)` as a composite primary key so that
ingestion can `INSERT ... ON DUPLICATE KEY UPDATE` and accumulate
`event_count`, replicating the ClickHouse `ReplacingMergeTree(ts_server)`
semantics.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, DateTime, Double, Integer, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class EventCommonMixin:
    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(BigInteger(), "mysql"), primary_key=True, autoincrement=True
    )
    ts_server: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    ts_client: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    app: Mapped[str] = mapped_column(String(32), nullable=False)
    env: Mapped[str] = mapped_column(String(32), nullable=False)
    release: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    user_id: Mapped[str | None] = mapped_column(String(64))
    username: Mapped[str | None] = mapped_column(String(120))
    is_admin: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    session_id: Mapped[str] = mapped_column(String(128), nullable=False)
    trace_id: Mapped[str | None] = mapped_column(String(64))
    route: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(String(512), nullable=False, default="")


class EventPerformRow(Base, EventCommonMixin):
    __tablename__ = "events_perform"

    metric: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[float] = mapped_column(Double, nullable=False, default=0.0)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class EventErrorRow(Base, EventCommonMixin):
    __tablename__ = "events_error"

    fingerprint: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    message: Mapped[str | None] = mapped_column(Text)
    stack: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class EventWarningRow(Base, EventCommonMixin):
    __tablename__ = "events_warning"

    level: Mapped[str] = mapped_column(String(32), nullable=False, default="warning")
    message: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class EventBusinessRow(Base, EventCommonMixin):
    __tablename__ = "events_business"

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class SessionRow(Base):
    __tablename__ = "sessions"

    app: Mapped[str] = mapped_column(String(32), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    ts_server: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    env: Mapped[str] = mapped_column(String(32), nullable=False)
    release: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    user_id: Mapped[str | None] = mapped_column(String(64))
    username: Mapped[str | None] = mapped_column(String(120))
    is_admin: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    route: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    event_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
