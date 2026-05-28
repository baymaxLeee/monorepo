"""Message persistence operations."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chat.models.message import MessageRow


async def list_messages(
    session: AsyncSession,
    conversation_id: str,
) -> list[MessageRow]:
    stmt = (
        select(MessageRow)
        .where(MessageRow.conversation_id == conversation_id)
        .order_by(MessageRow.created_at, MessageRow.id)
    )
    result = await session.scalars(stmt)
    return list(result.all())


async def create_message(
    session: AsyncSession,
    *,
    conversation_id: str,
    role: str,
    content: str,
    status: str = "ok",
) -> MessageRow:
    row = MessageRow(
        id=uuid4().hex[:16],
        conversation_id=conversation_id,
        role=role,
        content=content,
        status=status,
        created_at=datetime.now(UTC),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row
