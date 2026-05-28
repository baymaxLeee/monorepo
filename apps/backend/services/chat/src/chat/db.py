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
from .models.conversation import ConversationRow
from .models.message import MessageRow

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


async def init_db() -> None:
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


_DEMO_CONVERSATION_ID = "demo-conv-1"
_DEMO_USER_ID = "demo-super-admin"
_DEMO_MESSAGES: list[tuple[str, str, str]] = [
    (
        "demo-msg-1",
        "user",
        "你好, 介绍一下这个平台是做什么的?",
    ),
    (
        "demo-msg-2",
        "assistant",
        "这是一个 demo 阶段的多 agent 平台, 前端是 module federation 的 "
        "micro-frontends, 后端是 FastAPI/Go 的 microservices. 你现在在 chat "
        "服务里, 可以接 OpenAI 兼容的大模型上来对话.",
    ),
]


async def seed_demo_conversations() -> None:
    factory = get_session_factory()
    async with factory() as session:
        existing = await session.scalar(select(ConversationRow.id).limit(1))
        if existing is not None:
            return

        created = datetime.fromisoformat("2026-05-20T10:00:00+00:00")
        session.add(
            ConversationRow(
                id=_DEMO_CONVERSATION_ID,
                user_id=_DEMO_USER_ID,
                title="平台介绍",
                model="",
                created_at=created,
                updated_at=created,
            )
        )

        ts = created
        for msg_id, role, content in _DEMO_MESSAGES:
            session.add(
                MessageRow(
                    id=msg_id,
                    conversation_id=_DEMO_CONVERSATION_ID,
                    role=role,
                    content=content,
                    status="ok",
                    created_at=ts.replace(tzinfo=UTC),
                )
            )

        await session.commit()
