"""Conversation document persistence operations."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from chat.models.document import ConversationDocumentRow


async def list_documents(
    session: AsyncSession,
    conversation_id: str,
) -> list[ConversationDocumentRow]:
    stmt = (
        select(ConversationDocumentRow)
        .where(ConversationDocumentRow.conversation_id == conversation_id)
        .order_by(ConversationDocumentRow.created_at, ConversationDocumentRow.id)
    )
    result = await session.scalars(stmt)
    return list(result.all())


async def get_document(
    session: AsyncSession,
    *,
    conversation_id: str,
    document_id: str,
) -> ConversationDocumentRow | None:
    stmt = select(ConversationDocumentRow).where(
        ConversationDocumentRow.conversation_id == conversation_id,
        ConversationDocumentRow.id == document_id,
    )
    result = await session.scalars(stmt)
    return result.one_or_none()


async def create_document(
    session: AsyncSession,
    *,
    conversation_id: str,
    kind: str,
    title: str,
    filename: str,
    mime_type: str,
    content_md: str,
    source_size: int = 0,
    source_mime_type: str | None = None,
    source_object_bucket: str | None = None,
    source_object_key: str | None = None,
    source_sha256: str | None = None,
    source_filename: str | None = None,
    ingest_status: str = "ready",
    ingest_progress: int = 100,
    ingest_error: str | None = None,
) -> ConversationDocumentRow:
    now = datetime.now(UTC)
    row = ConversationDocumentRow(
        id=uuid4().hex[:16],
        conversation_id=conversation_id,
        kind=kind,
        title=title,
        filename=filename,
        mime_type=mime_type,
        content_md=content_md,
        source_size=source_size,
        source_mime_type=source_mime_type,
        source_object_bucket=source_object_bucket,
        source_object_key=source_object_key,
        source_sha256=source_sha256,
        source_filename=source_filename,
        ingest_status=ingest_status,
        ingest_progress=ingest_progress,
        ingest_error=ingest_error,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def update_document(
    session: AsyncSession,
    row: ConversationDocumentRow,
    values: dict[str, object],
) -> ConversationDocumentRow:
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(row)
    return row
