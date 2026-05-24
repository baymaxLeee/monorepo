"""Bot persistence operations."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from admin.models.bot import BotRow


async def list_bots(session: AsyncSession, user_id: str, is_admin: bool) -> list[BotRow]:
    stmt = select(BotRow).order_by(BotRow.created_at)
    if not is_admin:
        stmt = stmt.where(BotRow.user_id == user_id)
    result = await session.scalars(stmt)
    return list(result.all())


async def get_bot(session: AsyncSession, bot_id: str, user_id: str, is_admin: bool) -> BotRow | None:
    stmt = select(BotRow).where(BotRow.id == bot_id)
    if not is_admin:
        stmt = stmt.where(BotRow.user_id == user_id)
    result = await session.scalars(stmt)
    return result.one_or_none()


async def create_bot(session: AsyncSession, name: str, user_id: str) -> BotRow:
    row = BotRow(
        id=uuid4().hex[:8],
        user_id=user_id,
        name=name,
        status="draft",
        created_at=datetime.now(UTC),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row
