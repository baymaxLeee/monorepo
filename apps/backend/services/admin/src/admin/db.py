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
from .models.apps import AppRow
from .models.base import Base
from .models.bot import BotRow
from .models.intention import IntentionRow
from .models.provider import ModelProviderRow  # noqa: F401 — registers with Base.metadata
from .models.scene import SceneRow

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


_DEMO_SCENES: list[tuple[str, str, str, str, bool, str]] = [
    (
        "scene-1",
        "新用户引导",
        "增长团队 onboarding 场景",
        "active",
        True,
        "2026-05-20T10:24:00+00:00",
    ),
    (
        "scene-2",
        "售后支持",
        "客服售后处理场景",
        "draft",
        False,
        "2026-05-18T17:42:00+00:00",
    ),
]

_DEMO_INTENTIONS: list[tuple[str, str, str, int, str, bool, str]] = [
    (
        "intent-1",
        "查询订单",
        "售后支持",
        24,
        "active",
        True,
        "2026-05-20T11:24:00+00:00",
    ),
    (
        "intent-2",
        "变更套餐",
        "新用户引导",
        18,
        "draft",
        False,
        "2026-05-18T18:42:00+00:00",
    ),
]


_DEMO_APPS: list[tuple[str, str, str, str, bool, int]] = [
    ("admin", "后台管理", "/platform/admin", "mfe_admin", True, 10),
    ("chat", "对话", "/platform/chat", "mfe_chat", True, 20),
]


# Structured demo bot profile. The full RCA workflow (retrieval routing, four-part
# answer format, read-only safety) belongs to a code-versioned skill later; the
# profile only carries the structured identity the prompt renderer consumes.
_DEMO_ONCALL_BOT = {
    "id": "bot-oncall",
    "name": "Oncall 排查助手",
    "role_description": (
        "团队 Oncall 事故排查助手：结合团队历史复盘与运维文档，帮助值班同学定位并处置线上问题。"
        "按 根因 / 排查 / 验证 / 修复 四段作答，每条标注出处与置信度；只读建议，不代替人工执行高危操作。"
    ),
    "domain_description": "团队线上事故排查、SOP、Runbook、架构与配置知识库。",
    "audience": "一线值班与运维工程师",
    "tone": "professional",
    "welcome_message": (
        "描述你遇到的线上问题，我会结合团队复盘与文档，给出根因分析、排查步骤、验证方法与修复建议。"
    ),
    "suggested_questions": [
        "服务 5xx 突然升高，如何快速定位根因？",
        "数据库连接池被打满，怎么一步步排查？",
        "发布后接口大面积超时，回滚前应先确认什么？",
    ],
    "status": "published",
    "created_at": "2026-05-20T09:00:00+00:00",
}


async def seed_demo_bots() -> None:
    app_entries = {
        "admin": "/mfe-admin/mf-manifest.json",
        "chat": "/mfe-chat/mf-manifest.json",
    }
    factory = get_session_factory()
    async with factory() as session:
        existing_app = await session.scalar(select(AppRow.id).limit(1))
        if existing_app is None:
            for app_id, title, base_path, remote_name, requires_admin, sort_order in _DEMO_APPS:
                now = datetime.now(UTC)
                session.add(
                    AppRow(
                        id=app_id,
                        title=title,
                        base_path=base_path,
                        remote_name=remote_name,
                        expose_key="./App",
                        entry=app_entries.get(app_id, ""),
                        requires_admin=requires_admin,
                        is_enabled=True,
                        sort_order=sort_order,
                        created_at=now,
                        updated_at=now,
                    )
                )

        existing_scene = await session.scalar(select(SceneRow.id).limit(1))
        if existing_scene is None:
            for scene_id, name, description, status, enabled, created_at in _DEMO_SCENES:
                created = datetime.fromisoformat(created_at)
                session.add(
                    SceneRow(
                        id=scene_id,
                        user_id="demo-super-admin",
                        org_id="guest-org",
                        username="admin",
                        name=name,
                        description=description,
                        status=status,
                        is_enabled=enabled,
                        created_at=created,
                        updated_at=created,
                    )
                )

        existing_intention = await session.scalar(select(IntentionRow.id).limit(1))
        if existing_intention is None:
            for (
                intention_id,
                name,
                scene_name,
                examples,
                status,
                enabled,
                created_at,
            ) in _DEMO_INTENTIONS:
                created = datetime.fromisoformat(created_at)
                session.add(
                    IntentionRow(
                        id=intention_id,
                        user_id="demo-super-admin",
                        org_id="guest-org",
                        username="admin",
                        name=name,
                        description="",
                        scene_name=scene_name,
                        examples=examples,
                        status=status,
                        is_enabled=enabled,
                        created_at=created,
                        updated_at=created,
                    )
                )

        existing_bot = await session.scalar(select(BotRow.id).limit(1))
        if existing_bot is None:
            bot = _DEMO_ONCALL_BOT
            created = datetime.fromisoformat(str(bot["created_at"]))
            session.add(
                BotRow(
                    id=bot["id"],
                    user_id="demo-super-admin",
                    org_id="guest-org",
                    name=bot["name"],
                    role_description=bot["role_description"],
                    domain_description=bot["domain_description"],
                    audience=bot["audience"],
                    tone=bot["tone"],
                    welcome_message=bot["welcome_message"],
                    suggested_questions=bot["suggested_questions"],
                    status=bot["status"],
                    created_at=created,
                    updated_at=created,
                )
            )

        await session.commit()
