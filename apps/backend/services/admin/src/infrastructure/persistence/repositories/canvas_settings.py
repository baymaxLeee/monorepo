from datetime import UTC, datetime

from sqlalchemy import Update, select, update
from sqlalchemy.dialects.postgresql import Insert, insert
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.persistence.models.canvas_settings import CanvasSettingsRow


async def get(session: AsyncSession, workspace_id: str, tenant_id: str) -> CanvasSettingsRow | None:
    result = await session.scalars(
        select(CanvasSettingsRow).where(
            (CanvasSettingsRow.workspace_id == workspace_id) & (CanvasSettingsRow.tenant_id == tenant_id)
        )
    )
    return result.one_or_none()


async def save(
    session: AsyncSession, workspace_id: str, tenant_id: str, user_id: str, revision: int, defaults_json: str
) -> bool:
    values = dict(defaults_json=defaults_json, revision=revision + 1, updated_by=user_id, updated_at=datetime.now(UTC))
    statement: Insert | Update
    if revision == 0:
        statement = (
            insert(CanvasSettingsRow)
            .values(workspace_id=workspace_id, tenant_id=tenant_id, **values)
            .on_conflict_do_nothing()
        )
    else:
        statement = (
            update(CanvasSettingsRow)
            .where(
                (CanvasSettingsRow.workspace_id == workspace_id) & (CanvasSettingsRow.tenant_id == tenant_id),
                CanvasSettingsRow.revision == revision,
            )
            .values(**values)
        )
    result = await session.execute(statement.returning(CanvasSettingsRow.workspace_id, CanvasSettingsRow.tenant_id))
    return result.scalar_one_or_none() is not None
