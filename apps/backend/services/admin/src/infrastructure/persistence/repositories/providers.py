"""Model provider persistence operations."""

from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from sqlalchemy import delete, select, text, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.persistence.models.provider import PROVIDER_KIND_CHAT, ModelProviderRow


async def lock_default_selection(session: AsyncSession, workspace_id: str, tenant_id: str) -> None:
    """Serialize default-provider mutations for one tenant/workspace."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"model-provider-default:{tenant_id}:{workspace_id}"},
    )


async def list_providers(session: AsyncSession, workspace_id: str, tenant_id: str) -> list[ModelProviderRow]:
    stmt = (
        select(ModelProviderRow)
        .where((ModelProviderRow.workspace_id == workspace_id) & (ModelProviderRow.tenant_id == tenant_id))
        .order_by(ModelProviderRow.is_default.desc(), ModelProviderRow.updated_at.desc())
    )
    result = await session.scalars(stmt)
    return list(result.all())


async def get_provider(
    session: AsyncSession, provider_id: str, workspace_id: str, tenant_id: str
) -> ModelProviderRow | None:
    stmt = select(ModelProviderRow).where(
        ModelProviderRow.id == provider_id,
        (ModelProviderRow.workspace_id == workspace_id) & (ModelProviderRow.tenant_id == tenant_id),
    )
    result = await session.scalars(stmt)
    return result.one_or_none()


async def get_provider_for_internal(session: AsyncSession, provider_id: str) -> ModelProviderRow | None:
    """Internal lookup (no user-scope filter). Caller MUST authorize separately."""
    return await session.get(ModelProviderRow, provider_id)


async def get_default_provider(session: AsyncSession, workspace_id: str, tenant_id: str) -> ModelProviderRow | None:
    stmt = (
        select(ModelProviderRow)
        .where(
            (ModelProviderRow.workspace_id == workspace_id) & (ModelProviderRow.tenant_id == tenant_id),
            ModelProviderRow.is_default.is_(True),
            ModelProviderRow.is_enabled.is_(True),
            ModelProviderRow.provider_kind == PROVIDER_KIND_CHAT,
        )
        .order_by(ModelProviderRow.updated_at.desc())
        .limit(1)
    )
    result = await session.scalars(stmt)
    return result.one_or_none()


async def get_first_enabled_by_kind(
    session: AsyncSession, workspace_id: str, tenant_id: str, kind: str
) -> ModelProviderRow | None:
    """Most-recently-updated enabled provider of a given kind for the team (workspace).

    Non-chat kinds (embedding, rerank, image, video) have no `is_default`
    flag — consumers that need one (e.g. knowledge picking an embedding model)
    take the newest enabled provider of that kind.
    """
    stmt = (
        select(ModelProviderRow)
        .where(
            (ModelProviderRow.workspace_id == workspace_id) & (ModelProviderRow.tenant_id == tenant_id),
            ModelProviderRow.is_enabled.is_(True),
            ModelProviderRow.provider_kind == kind,
        )
        .order_by(ModelProviderRow.updated_at.desc())
        .limit(1)
    )
    result = await session.scalars(stmt)
    return result.one_or_none()


async def clear_default_flag(session: AsyncSession, workspace_id: str, tenant_id: str) -> None:
    await session.execute(
        update(ModelProviderRow)
        .where(
            (ModelProviderRow.workspace_id == workspace_id) & (ModelProviderRow.tenant_id == tenant_id),
            ModelProviderRow.is_default.is_(True),
        )
        .values(is_default=False, updated_at=datetime.now(UTC))
    )


async def create_provider(
    session: AsyncSession,
    *,
    user_id: str,
    workspace_id: str,
    tenant_id: str,
    name: str,
    model: str,
    provider_kind: str,
    responses_dialect: str | None,
    base_url: str,
    api_key_enc: str,
    extra_body: str,
    pricing_json: str | None,
    context_window: int,
    max_output_tokens: int,
    supports_image_input: bool,
    is_default: bool,
    is_enabled: bool,
) -> ModelProviderRow:
    now = datetime.now(UTC)
    row = ModelProviderRow(
        id=uuid4().hex[:12],
        user_id=user_id,
        workspace_id=workspace_id,
        tenant_id=tenant_id,
        name=name,
        model=model,
        provider_kind=provider_kind,
        responses_dialect=responses_dialect,
        base_url=base_url,
        api_key_enc=api_key_enc,
        extra_body=extra_body,
        pricing_json=pricing_json,
        context_window=context_window,
        max_output_tokens=max_output_tokens,
        supports_image_input=supports_image_input,
        is_default=is_default,
        is_enabled=is_enabled,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    return row


async def update_provider(session: AsyncSession, row: ModelProviderRow, values: dict[str, object]) -> ModelProviderRow:
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(UTC)
    await session.flush()
    return row


async def delete_provider(session: AsyncSession, row: ModelProviderRow) -> None:
    await session.delete(row)


async def bulk_delete_providers(session: AsyncSession, ids: list[str], workspace_id: str, tenant_id: str) -> int:
    stmt = delete(ModelProviderRow).where(
        ModelProviderRow.id.in_(ids),
        (ModelProviderRow.workspace_id == workspace_id) & (ModelProviderRow.tenant_id == tenant_id),
    )
    result = await session.execute(stmt)
    return cast(CursorResult[object], result).rowcount or 0
