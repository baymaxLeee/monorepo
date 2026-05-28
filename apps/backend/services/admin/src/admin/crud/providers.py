"""Model provider persistence operations."""

from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from sqlalchemy import delete, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from admin.models.provider import ModelProviderRow


async def list_providers(
    session: AsyncSession,
    user_id: str,
    is_admin: bool,
) -> list[ModelProviderRow]:
    stmt = select(ModelProviderRow).order_by(
        ModelProviderRow.is_default.desc(),
        ModelProviderRow.updated_at.desc(),
    )
    if not is_admin:
        stmt = stmt.where(ModelProviderRow.user_id == user_id)
    result = await session.scalars(stmt)
    return list(result.all())


async def get_provider(
    session: AsyncSession,
    provider_id: str,
    user_id: str,
    is_admin: bool,
) -> ModelProviderRow | None:
    stmt = select(ModelProviderRow).where(ModelProviderRow.id == provider_id)
    if not is_admin:
        stmt = stmt.where(ModelProviderRow.user_id == user_id)
    result = await session.scalars(stmt)
    return result.one_or_none()


async def get_provider_for_internal(
    session: AsyncSession,
    provider_id: str,
) -> ModelProviderRow | None:
    """Internal lookup (no user-scope filter). Caller MUST authorize separately."""

    return await session.get(ModelProviderRow, provider_id)


async def get_default_provider(
    session: AsyncSession,
    user_id: str,
) -> ModelProviderRow | None:
    stmt = (
        select(ModelProviderRow)
        .where(
            ModelProviderRow.user_id == user_id,
            ModelProviderRow.is_default.is_(True),
            ModelProviderRow.is_enabled.is_(True),
        )
        .order_by(ModelProviderRow.updated_at.desc())
        .limit(1)
    )
    result = await session.scalars(stmt)
    return result.one_or_none()


async def clear_default_flag(session: AsyncSession, user_id: str) -> None:
    await session.execute(
        update(ModelProviderRow)
        .where(ModelProviderRow.user_id == user_id, ModelProviderRow.is_default.is_(True))
        .values(is_default=False, updated_at=datetime.now(UTC))
    )


async def create_provider(
    session: AsyncSession,
    *,
    user_id: str,
    name: str,
    model: str,
    base_url: str,
    api_key_enc: str,
    extra_body: str,
    is_default: bool,
    is_enabled: bool,
) -> ModelProviderRow:
    now = datetime.now(UTC)
    row = ModelProviderRow(
        id=uuid4().hex[:12],
        user_id=user_id,
        name=name,
        model=model,
        base_url=base_url,
        api_key_enc=api_key_enc,
        extra_body=extra_body,
        is_default=is_default,
        is_enabled=is_enabled,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def update_provider(
    session: AsyncSession,
    row: ModelProviderRow,
    values: dict[str, object],
) -> ModelProviderRow:
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(row)
    return row


async def delete_provider(session: AsyncSession, row: ModelProviderRow) -> None:
    await session.delete(row)
    await session.commit()


async def bulk_delete_providers(
    session: AsyncSession,
    ids: list[str],
    user_id: str,
    is_admin: bool,
) -> int:
    stmt = delete(ModelProviderRow).where(ModelProviderRow.id.in_(ids))
    if not is_admin:
        stmt = stmt.where(ModelProviderRow.user_id == user_id)
    result = await session.execute(stmt)
    await session.commit()
    return cast(CursorResult[object], result).rowcount or 0
