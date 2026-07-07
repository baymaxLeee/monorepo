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
    org_id: str | None = None,
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
        org_id=org_id,
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
    row = await session.scalar(select(DocumentRow).where(DocumentRow.id == document_id, DocumentRow.user_id == user_id))
    return row


async def get_document_by_id(session: AsyncSession, document_id: str) -> DocumentRow | None:
    """Fetch a document with no ACL. Internal-only (indexing derives the
    uploader + org from the row itself)."""
    row = await session.scalar(select(DocumentRow).where(DocumentRow.id == document_id))
    return row


async def get_org_document(session: AsyncSession, document_id: str, org_id: str) -> DocumentRow | None:
    """Team-scoped read: any member of the owning org may access the document."""
    row = await session.scalar(
        select(DocumentRow).where(DocumentRow.id == document_id, DocumentRow.org_id == org_id)
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


async def list_documents_by_ids(
    session: AsyncSession,
    *,
    user_id: str,
    document_ids: list[str],
) -> list[DocumentRow]:
    """Fetch the caller's documents for the given ids (used by batch delete)."""
    if not document_ids:
        return []
    stmt = select(DocumentRow).where(
        DocumentRow.user_id == user_id,
        DocumentRow.id.in_(document_ids),
    )
    result = await session.scalars(stmt)
    return list(result.all())


async def list_org_documents(
    session: AsyncSession,
    *,
    org_id: str,
    kind: str | None = None,
) -> list[DocumentRow]:
    """Team knowledge base: every member sees the org's documents."""
    stmt = select(DocumentRow).where(DocumentRow.org_id == org_id).order_by(DocumentRow.created_at.desc())
    if kind:
        stmt = stmt.where(DocumentRow.kind == kind)
    result = await session.scalars(stmt)
    return list(result.all())


async def list_org_documents_by_ids(
    session: AsyncSession,
    *,
    org_id: str,
    document_ids: list[str],
) -> list[DocumentRow]:
    """Fetch the org's documents for the given ids (used by team batch delete)."""
    if not document_ids:
        return []
    stmt = select(DocumentRow).where(
        DocumentRow.org_id == org_id,
        DocumentRow.id.in_(document_ids),
    )
    result = await session.scalars(stmt)
    return list(result.all())


async def get_documents_meta(
    session: AsyncSession,
    document_ids: list[str],
) -> dict[str, tuple[str, str]]:
    """Map document_id -> (title, filename) for citation rendering."""
    if not document_ids:
        return {}
    stmt = select(DocumentRow.id, DocumentRow.title, DocumentRow.filename).where(DocumentRow.id.in_(document_ids))
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


async def set_index_status(
    session: AsyncSession,
    document_id: str,
    *,
    status: str,
    error: str | None = None,
) -> None:
    """Write the async-indexing lifecycle state without touching ``updated_at``.

    Indexing is a background side effect, not a content edit, so it must not
    reorder the document list's "updated time" column.
    """
    await session.execute(
        update(DocumentRow).where(DocumentRow.id == document_id).values(index_status=status, index_error=error)
    )


async def delete_document(session: AsyncSession, row: DocumentRow) -> None:
    await session.delete(row)
    await session.flush()
