"""App registry persistence operations."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.persistence.models.apps import AppRow


async def list_apps(
    session: AsyncSession,
    *,
    include_disabled: bool,
    include_admin_only: bool,
) -> list[AppRow]:
    """Server-side visibility filter so admin-only/disabled app metadata never
    leaves the service for callers without the privilege. `include_disabled` is
    for super_admin management; `include_admin_only` also covers org_admins who
    must mount the admin MFE."""
    stmt = select(AppRow).order_by(AppRow.sort_order.asc(), AppRow.created_at.asc())
    if not include_disabled:
        stmt = stmt.where(AppRow.is_enabled.is_(True))
    if not include_admin_only:
        stmt = stmt.where(AppRow.requires_admin.is_(False))
    result = await session.scalars(stmt)
    return list(result.all())


async def get_app(session: AsyncSession, app_id: str) -> AppRow | None:
    result = await session.scalars(select(AppRow).where(AppRow.id == app_id))
    return result.one_or_none()


async def create_app(
    session: AsyncSession,
    *,
    app_id: str,
    title: str,
    base_path: str,
    remote_name: str,
    expose_key: str,
    entry: str,
    requires_admin: bool,
    is_enabled: bool,
    sort_order: int,
) -> AppRow:
    now = datetime.now(UTC)
    row = AppRow(
        id=app_id,
        title=title,
        base_path=base_path,
        remote_name=remote_name,
        expose_key=expose_key,
        entry=entry,
        requires_admin=requires_admin,
        is_enabled=is_enabled,
        sort_order=sort_order,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    return row


async def update_app(session: AsyncSession, row: AppRow, values: dict[str, object]) -> AppRow:
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(UTC)
    await session.flush()
    return row


async def delete_app(session: AsyncSession, row: AppRow) -> None:
    await session.delete(row)
