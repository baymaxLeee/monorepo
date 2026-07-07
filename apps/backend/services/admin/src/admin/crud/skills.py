"""Skill persistence operations."""

from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from admin.models.skill import SkillRow


async def list_skills(session: AsyncSession, org_id: str) -> list[SkillRow]:
    stmt = select(SkillRow).where(SkillRow.org_id == org_id).order_by(SkillRow.updated_at.desc())
    result = await session.scalars(stmt)
    return list(result.all())


async def get_skill(session: AsyncSession, skill_id: str, org_id: str) -> SkillRow | None:
    stmt = select(SkillRow).where(SkillRow.id == skill_id, SkillRow.org_id == org_id)
    result = await session.scalars(stmt)
    return result.one_or_none()


async def get_skill_internal(session: AsyncSession, skill_id: str) -> SkillRow | None:
    """Trusted by-id lookup for `/internal` callers (no org scope — the internal
    token is the trust boundary and the id is opaque)."""
    stmt = select(SkillRow).where(SkillRow.id == skill_id)
    result = await session.scalars(stmt)
    return result.one_or_none()


async def get_skill_by_name(session: AsyncSession, org_id: str, name: str) -> SkillRow | None:
    stmt = select(SkillRow).where(SkillRow.org_id == org_id, SkillRow.name == name)
    result = await session.scalars(stmt)
    return result.one_or_none()


async def create_skill(
    session: AsyncSession,
    *,
    name: str,
    description: str,
    body: str,
    status: str,
    is_enabled: bool,
    user_id: str,
    org_id: str,
    username: str,
) -> SkillRow:
    now = datetime.now(UTC)
    row = SkillRow(
        id=uuid4().hex[:8],
        user_id=user_id,
        org_id=org_id,
        username=username or user_id,
        name=name,
        description=description,
        body=body,
        status=status,
        is_enabled=is_enabled,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    return row


async def update_skill(session: AsyncSession, row: SkillRow, values: dict[str, object]) -> SkillRow:
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(UTC)
    await session.flush()
    return row


async def delete_skill(session: AsyncSession, row: SkillRow) -> None:
    await session.delete(row)


async def bulk_delete_skills(session: AsyncSession, ids: list[str], org_id: str) -> int:
    stmt = delete(SkillRow).where(SkillRow.id.in_(ids), SkillRow.org_id == org_id)
    result = await session.execute(stmt)
    return cast(CursorResult[object], result).rowcount or 0
