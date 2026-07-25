"""Persistence helpers for staged generated media."""

from datetime import UTC, datetime
from secrets import token_hex

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.persistence.models.staged_media import StagedMediaRow


async def get_staged_media(session: AsyncSession, staged_id: str, user_id: str) -> StagedMediaRow | None:
    return await session.scalar(
        select(StagedMediaRow).where(StagedMediaRow.id == staged_id, StagedMediaRow.user_id == user_id)
    )


async def get_by_idempotency_key(session: AsyncSession, idempotency_key: str, user_id: str) -> StagedMediaRow | None:
    return await session.scalar(
        select(StagedMediaRow).where(
            StagedMediaRow.idempotency_key == idempotency_key,
            StagedMediaRow.user_id == user_id,
        )
    )


async def create_staged_media(
    session: AsyncSession,
    *,
    user_id: str,
    org_id: str,
    conversation_id: str | None,
    title: str,
    filename: str,
    mime_type: str,
    size: int,
    object_bucket: str,
    object_key: str,
    object_sha256: str,
    idempotency_key: str | None,
    staged_id: str | None = None,
) -> StagedMediaRow:
    now = datetime.now(UTC)
    row = StagedMediaRow(
        id=staged_id or token_hex(8),
        user_id=user_id,
        org_id=org_id,
        conversation_id=conversation_id,
        title=title[:255],
        filename=filename[:255],
        mime_type=mime_type,
        size=size,
        object_bucket=object_bucket,
        object_key=object_key,
        object_sha256=object_sha256,
        idempotency_key=idempotency_key,
        status="staged",
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    return row
