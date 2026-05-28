"""Intention persistence operations."""

from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from admin.models.intention import IntentionRow


async def list_intentions(session: AsyncSession, user_id: str, is_admin: bool) -> list[IntentionRow]:
    stmt = select(IntentionRow).order_by(IntentionRow.updated_at.desc())
    if not is_admin:
        stmt = stmt.where(IntentionRow.user_id == user_id)
    result = await session.scalars(stmt)
    return list(result.all())


async def get_intention(
    session: AsyncSession,
    intention_id: str,
    user_id: str,
    is_admin: bool,
) -> IntentionRow | None:
    stmt = select(IntentionRow).where(IntentionRow.id == intention_id)
    if not is_admin:
        stmt = stmt.where(IntentionRow.user_id == user_id)
    result = await session.scalars(stmt)
    return result.one_or_none()


async def create_intention(
    session: AsyncSession,
    *,
    description: str,
    examples: int,
    is_enabled: bool,
    name: str,
    scene_name: str,
    status: str,
    user_id: str,
    username: str,
) -> IntentionRow:
    now = datetime.now(UTC)
    row = IntentionRow(
        id=uuid4().hex[:8],
        user_id=user_id,
        username=username or user_id,
        name=name,
        description=description,
        scene_name=scene_name,
        examples=examples,
        status=status,
        is_enabled=is_enabled,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def update_intention(
    session: AsyncSession,
    row: IntentionRow,
    values: dict[str, object],
) -> IntentionRow:
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(row)
    return row


async def delete_intention(session: AsyncSession, row: IntentionRow) -> None:
    await session.delete(row)
    await session.commit()


async def bulk_delete_intentions(
    session: AsyncSession,
    ids: list[str],
    user_id: str,
    is_admin: bool,
) -> int:
    stmt = delete(IntentionRow).where(IntentionRow.id.in_(ids))
    if not is_admin:
        stmt = stmt.where(IntentionRow.user_id == user_id)
    result = await session.execute(stmt)
    await session.commit()
    return cast(CursorResult[object], result).rowcount or 0
