"""Async SQLAlchemy engine and session factory."""

from collections.abc import AsyncGenerator
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from .config import get_settings
from .models.base import Base
from .models.bot import BotRow


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


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def init_db() -> None:
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


_DEMO_BOTS: list[tuple[str, str, str, str]] = [
    ("demo-1", "客服助手", "published", "2026-01-15T08:30:00+00:00"),
    ("demo-2", "销售小助理", "draft", "2026-02-20T11:15:00+00:00"),
    ("demo-3", "代码评审员", "published", "2026-03-10T16:42:00+00:00"),
]


async def seed_demo_bots() -> None:
    factory = get_session_factory()
    async with factory() as session:
        existing = await session.scalar(select(BotRow.id).limit(1))
        if existing is not None:
            return
        for bot_id, name, status, created_at in _DEMO_BOTS:
            session.add(
                BotRow(
                    id=bot_id,
                    name=name,
                    status=status,
                    created_at=datetime.fromisoformat(created_at),
                )
            )
        await session.commit()
