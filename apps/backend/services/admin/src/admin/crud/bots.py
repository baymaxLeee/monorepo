"""Bot persistence operations."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from admin.models.bot import BotRow


async def list_bots(session: AsyncSession, user_id: str) -> list[BotRow]:
    result = await session.scalars(select(BotRow).where(BotRow.user_id == user_id).order_by(BotRow.created_at))
    return list(result.all())


async def get_bot(session: AsyncSession, bot_id: str, user_id: str) -> BotRow | None:
    result = await session.scalars(select(BotRow).where(BotRow.id == bot_id, BotRow.user_id == user_id))
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
