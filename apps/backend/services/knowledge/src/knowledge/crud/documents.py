"""Document persistence."""

from datetime import UTC, datetime
from secrets import token_hex
from typing import Any, cast

from knowledge.models.document import DocumentRow
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession


def new_document_id() -> str:
    return token_hex(8)


async def create_document(
    session: AsyncSession,
    *,
    user_id: str,
    kind: str,
    title: str,
    filename: str,
    mime_type: str,
    content_md: str = "",
    conversation_id: str | None = None,
    source_size: int = 0,
    source_mime_type: str | None = None,
    object_bucket: str | None = None,
    object_key: str | None = None,
    object_sha256: str | None = None,
    source_filename: str | None = None,
    ingest_status: str = "ready",
    ingest_progress: int = 100,
    ingest_error: str | None = None,
    document_id: str | None = None,
) -> DocumentRow:
    now = datetime.now(UTC)
    row = DocumentRow(
        id=document_id or new_document_id(),
        user_id=user_id,
        conversation_id=conversation_id,
        kind=kind,
        title=title[:255],
        filename=filename[:255],
        mime_type=mime_type,
        content_md=content_md,
        source_size=source_size,
        source_mime_type=source_mime_type,
        object_bucket=object_bucket,
        object_key=object_key,
        object_sha256=object_sha256,
        source_filename=source_filename,
        ingest_status=ingest_status,
        ingest_progress=ingest_progress,
        ingest_error=ingest_error,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    return row


async def get_document(session: AsyncSession, document_id: str, user_id: str) -> DocumentRow | None:
    row = await session.scalar(
        select(DocumentRow).where(DocumentRow.id == document_id, DocumentRow.user_id == user_id)
    )
    return row


async def list_documents(
    session: AsyncSession,
    *,
    user_id: str,
    conversation_id: str | None = None,
    kind: str | None = None,
) -> list[DocumentRow]:
    stmt = select(DocumentRow).where(DocumentRow.user_id == user_id).order_by(DocumentRow.created_at.desc())
    if conversation_id:
        stmt = stmt.where(DocumentRow.conversation_id == conversation_id)
    if kind:
        stmt = stmt.where(DocumentRow.kind == kind)
    result = await session.scalars(stmt)
    return list(result.all())


async def get_documents_meta(
    session: AsyncSession,
    document_ids: list[str],
) -> dict[str, tuple[str, str]]:
    """Map document_id -> (title, filename) for citation rendering."""
    if not document_ids:
        return {}
    stmt = select(DocumentRow.id, DocumentRow.title, DocumentRow.filename).where(
        DocumentRow.id.in_(document_ids)
    )
    result = await session.execute(stmt)
    return {row.id: (row.title, row.filename) for row in result.all()}


async def update_document(session: AsyncSession, row: DocumentRow, values: dict[str, Any]) -> DocumentRow:
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(UTC)
    await session.flush()
    return row


async def update_document_if_unchanged(
    session: AsyncSession,
    row: DocumentRow,
    values: dict[str, Any],
    *,
    expected_updated_at: datetime,
) -> DocumentRow | None:
    """Atomically update a document only when the caller's base version is current."""
    next_updated_at = datetime.now(UTC)
    result = cast(
        CursorResult[Any],
        await session.execute(
            update(DocumentRow)
            .where(
                DocumentRow.id == row.id,
                DocumentRow.user_id == row.user_id,
                DocumentRow.updated_at == expected_updated_at,
            )
            .values(**values, updated_at=next_updated_at)
        ),
    )
    if result.rowcount != 1:
        return None
    await session.refresh(row)
    return row


async def delete_document(session: AsyncSession, row: DocumentRow) -> None:
    await session.delete(row)
    await session.flush()
