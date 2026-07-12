"""Bot ↔ Skill binding persistence."""

from models.bot_skill import BotSkillRow
from models.skill import SkillRow
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession


async def list_skills_for_bot(session: AsyncSession, bot_id: str) -> list[SkillRow]:
    """All skills bound to a bot, ordered by binding sort then update time."""
    stmt = (
        select(SkillRow)
        .join(BotSkillRow, BotSkillRow.skill_id == SkillRow.id)
        .where(BotSkillRow.bot_id == bot_id)
        .order_by(BotSkillRow.sort, SkillRow.updated_at.desc())
    )
    result = await session.scalars(stmt)
    return list(result.all())


async def list_active_skills_for_bot(session: AsyncSession, bot_id: str) -> list[SkillRow]:
    """Only skills the model may actually use: bound AND active AND enabled."""
    stmt = (
        select(SkillRow)
        .join(BotSkillRow, BotSkillRow.skill_id == SkillRow.id)
        .where(
            BotSkillRow.bot_id == bot_id,
            SkillRow.status == "published",
            SkillRow.is_enabled.is_(True),
        )
        .order_by(BotSkillRow.sort, SkillRow.updated_at.desc())
    )
    result = await session.scalars(stmt)
    return list(result.all())


async def get_binding(session: AsyncSession, bot_id: str, skill_id: str) -> BotSkillRow | None:
    stmt = select(BotSkillRow).where(BotSkillRow.bot_id == bot_id, BotSkillRow.skill_id == skill_id)
    result = await session.scalars(stmt)
    return result.one_or_none()


async def attach_skill(session: AsyncSession, bot_id: str, skill_id: str) -> None:
    if await get_binding(session, bot_id, skill_id) is not None:
        return
    session.add(BotSkillRow(bot_id=bot_id, skill_id=skill_id, sort=0))
    await session.flush()


async def detach_skill(session: AsyncSession, bot_id: str, skill_id: str) -> None:
    await session.execute(delete(BotSkillRow).where(BotSkillRow.bot_id == bot_id, BotSkillRow.skill_id == skill_id))
