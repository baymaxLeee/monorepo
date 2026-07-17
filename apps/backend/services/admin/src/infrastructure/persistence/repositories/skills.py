"""Skill identity persistence operations."""

from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.persistence.models.skill import SkillRow


async def list_skills(session: AsyncSession, org_id: str) -> list[SkillRow]:
    result = await session.scalars(
        select(SkillRow).where(SkillRow.org_id == org_id).order_by(SkillRow.updated_at.desc())
    )
    return list(result.all())


async def get_skill(session: AsyncSession, skill_id: str, org_id: str) -> SkillRow | None:
    return await session.scalar(select(SkillRow).where(SkillRow.id == skill_id, SkillRow.org_id == org_id))


async def get_skill_by_name(session: AsyncSession, org_id: str, name: str) -> SkillRow | None:
    return await session.scalar(select(SkillRow).where(SkillRow.org_id == org_id, SkillRow.name == name))


async def create_skill(
    session: AsyncSession,
    *,
    name: str,
    description: str,
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
        status="draft",
        is_enabled=True,
        workspace_seq=1,
        workspace_sha256=None,
        published_sha256=None,
        published_at=None,
        published_name=None,
        published_description=None,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    return row


async def delete_skill(session: AsyncSession, row: SkillRow) -> None:
    await session.delete(row)


async def bulk_delete_skills(session: AsyncSession, ids: list[str], org_id: str) -> int:
    result = await session.execute(delete(SkillRow).where(SkillRow.id.in_(ids), SkillRow.org_id == org_id))
    return cast(CursorResult[object], result).rowcount or 0
