"""Bot persistence operations."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.persistence.models.bot import BotRow


async def list_bots(session: AsyncSession, workspace_id: str, tenant_id: str) -> list[BotRow]:
    stmt = (
        select(BotRow)
        .where((BotRow.workspace_id == workspace_id) & (BotRow.tenant_id == tenant_id))
        .order_by(BotRow.created_at)
    )
    result = await session.scalars(stmt)
    return list(result.all())


async def get_bot(session: AsyncSession, bot_id: str, workspace_id: str, tenant_id: str) -> BotRow | None:
    stmt = select(BotRow).where(
        BotRow.id == bot_id, (BotRow.workspace_id == workspace_id) & (BotRow.tenant_id == tenant_id)
    )
    result = await session.scalars(stmt)
    return result.one_or_none()


async def create_bot(session: AsyncSession, name: str, user_id: str, workspace_id: str, tenant_id: str) -> BotRow:
    now = datetime.now(UTC)
    row = BotRow(
        id=uuid4().hex[:8],
        user_id=user_id,
        workspace_id=workspace_id,
        tenant_id=tenant_id,
        name=name,
        status="draft",
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    return row


async def update_bot(session: AsyncSession, row: BotRow, values: dict[str, Any]) -> BotRow:
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(UTC)
    await session.flush()
    return row


async def delete_bot(session: AsyncSession, row: BotRow) -> None:
    await session.delete(row)
