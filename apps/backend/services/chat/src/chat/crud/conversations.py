"""Conversation persistence operations."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chat.models.conversation import ConversationRow


async def list_conversations(
    session: AsyncSession,
    user_id: str,
    is_admin: bool,
) -> list[ConversationRow]:
    stmt = select(ConversationRow).order_by(ConversationRow.updated_at.desc())
    if not is_admin:
        stmt = stmt.where(ConversationRow.user_id == user_id)
    result = await session.scalars(stmt)
    return list(result.all())


async def get_conversation(
    session: AsyncSession,
    conversation_id: str,
    user_id: str,
    is_admin: bool,
) -> ConversationRow | None:
    stmt = select(ConversationRow).where(ConversationRow.id == conversation_id)
    if not is_admin:
        stmt = stmt.where(ConversationRow.user_id == user_id)
    result = await session.scalars(stmt)
    return result.one_or_none()


async def create_conversation(
    session: AsyncSession,
    *,
    title: str,
    model: str,
    user_id: str,
    provider_id: str = "",
) -> ConversationRow:
    now = datetime.now(UTC)
    row = ConversationRow(
        id=uuid4().hex[:12],
        user_id=user_id,
        title=title,
        model=model,
        provider_id=provider_id,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def touch_conversation(
    session: AsyncSession,
    row: ConversationRow,
) -> ConversationRow:
    row.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(row)
    return row


async def update_conversation(
    session: AsyncSession,
    row: ConversationRow,
    values: dict[str, object],
) -> ConversationRow:
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(row)
    return row


async def delete_conversation(session: AsyncSession, row: ConversationRow) -> None:
    await session.delete(row)
    await session.commit()
