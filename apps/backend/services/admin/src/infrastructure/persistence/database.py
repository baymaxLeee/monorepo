"""Async SQLAlchemy engine and session factory."""

from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from bootstrap.config import get_settings
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from infrastructure.persistence.models.apps import AppRow

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            get_settings().database_url,
            pool_pre_ping=True,
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _session_factory


async def get_db_session() -> AsyncGenerator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        yield session


@asynccontextmanager
async def write_tx(session: AsyncSession) -> AsyncIterator[AsyncSession]:
    if session.in_transaction():
        raise RuntimeError("write_tx must be entered before any session IO")
    async with session.begin():
        yield session


async def close_db() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


_DEMO_APPS: list[tuple[str, str, str, str, bool, int]] = [
    ("admin", "后台管理", "/platform/admin", "mfe_admin", True, 10),
    ("chat", "对话", "/platform/chat", "mfe_chat", False, 20),
]


async def seed_demo_apps() -> None:
    app_entries = {
        "admin": "/mfe-admin/mf-manifest.json",
        "chat": "/mfe-chat/mf-manifest.json",
    }
    factory = get_session_factory()
    async with factory() as session, write_tx(session):
        for app_id, title, base_path, remote_name, requires_admin, sort_order in _DEMO_APPS:
            now = datetime.now(UTC)
            app = await session.get(AppRow, app_id)
            if app is None:
                session.add(
                    AppRow(
                        id=app_id,
                        title=title,
                        base_path=base_path,
                        remote_name=remote_name,
                        expose_key="./routes",
                        entry=app_entries.get(app_id, ""),
                        requires_admin=requires_admin,
                        is_enabled=True,
                        sort_order=sort_order,
                        created_at=now,
                        updated_at=now,
                    )
                )
                continue

            app.title = title
            app.base_path = base_path
            app.remote_name = remote_name
            app.expose_key = "./routes"
            app.entry = app_entries.get(app_id, "")
            app.updated_at = now
