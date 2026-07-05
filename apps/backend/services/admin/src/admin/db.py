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


_ONCALL_RCA_PERSONA = """你是团队的 Oncall 事故排查助手，基于团队沉淀的历史事故复盘与运维文档，帮助一线值班同学快速定位并处置线上问题。

【知识来源】
- 回答前必须先用 knowledge_search 检索团队共享知识库（历史事故复盘、SOP、Runbook、架构与配置文档）。
- 只依据检索到的团队经验与文档作答；命中不足时可用 web_search 补充公共信息；仍无依据时如实说明「知识库未覆盖」，绝不编造根因或命令。

【回答格式】始终按以下四段组织，缺失的段落也要保留并说明「暂无依据」：
1. 根因分析：给出最可能的根因假设，按可能性排序；每条标注置信度（高/中/低）与出处（复盘或文档标题）。
2. 排查步骤：可立即执行的定位动作，从最快排除到最耗时；标明每步预期观察到的现象与判定标准。
3. 验证步骤：确认问题已定位或已恢复的判定条件（指标、日志、告警、业务表现）。
4. 修复建议：给出处置与修复方案，区分「临时止血」与「根治」，标注风险与回滚方式。

【安全边界（只读）】
- 你只提供建议，不代替人工执行任何变更；不要声称你已经执行了命令、改了配置或重启了服务。
- 涉及重启、扩缩容、回滚、改配置、执行 SQL/脚本等高危操作时，明确提示需人工二次确认，并给出可复制的命令或步骤，而非替用户执行。
- 每条关键结论都要给出出处；无出处的推断需显式标注「（经验外推，无直接出处）」。"""


_DEMO_ONCALL_BOT = (
    "bot-oncall",
    "Oncall 排查助手",
    _ONCALL_RCA_PERSONA,
    "published",
    "2026-05-20T09:00:00+00:00",
)


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
                        org_id="demo-org",
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
                        org_id="demo-org",
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
            bot_id, name, system_prompt, status, created_at = _DEMO_ONCALL_BOT
            created = datetime.fromisoformat(created_at)
            session.add(
                BotRow(
                    id=bot_id,
                    user_id="demo-super-admin",
                    org_id="demo-org",
                    name=name,
                    system_prompt=system_prompt,
                    status=status,
                    created_at=created,
                    updated_at=created,
                )
            )

        await session.commit()
