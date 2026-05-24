"""Scene persistence operations."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from admin.models.scene import SceneRow


async def list_scenes(session: AsyncSession, user_id: str, is_admin: bool) -> list[SceneRow]:
    stmt = select(SceneRow).order_by(SceneRow.updated_at.desc())
    if not is_admin:
        stmt = stmt.where(SceneRow.user_id == user_id)
    result = await session.scalars(stmt)
    return list(result.all())


async def get_scene(
    session: AsyncSession,
    scene_id: str,
    user_id: str,
    is_admin: bool,
) -> SceneRow | None:
    stmt = select(SceneRow).where(SceneRow.id == scene_id)
    if not is_admin:
        stmt = stmt.where(SceneRow.user_id == user_id)
    result = await session.scalars(stmt)
    return result.one_or_none()


async def create_scene(
    session: AsyncSession,
    *,
    description: str,
    is_enabled: bool,
    name: str,
    status: str,
    user_id: str,
    username: str,
) -> SceneRow:
    now = datetime.now(UTC)
    row = SceneRow(
        id=uuid4().hex[:8],
        user_id=user_id,
        username=username or user_id,
        name=name,
        description=description,
        status=status,
        is_enabled=is_enabled,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def update_scene(session: AsyncSession, row: SceneRow, values: dict[str, object]) -> SceneRow:
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(row)
    return row


async def delete_scene(session: AsyncSession, row: SceneRow) -> None:
    await session.delete(row)
    await session.commit()


async def bulk_delete_scenes(
    session: AsyncSession,
    ids: list[str],
    user_id: str,
    is_admin: bool,
) -> int:
    stmt = delete(SceneRow).where(SceneRow.id.in_(ids))
    if not is_admin:
        stmt = stmt.where(SceneRow.user_id == user_id)
    result = await session.execute(stmt)
    await session.commit()
    return result.rowcount or 0
