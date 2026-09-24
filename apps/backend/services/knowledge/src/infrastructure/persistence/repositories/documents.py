"""Document persistence."""

from datetime import UTC, datetime
from secrets import token_hex
from typing import Any, cast

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.persistence.models.document import DocumentRow


def new_document_id() -> str:
    return token_hex(8)


async def create_document(
    session: AsyncSession,
    *,
    user_id: str,
    workspace_id: str | None = None,
    tenant_id: str | None = None,
    kind: str,
    title: str,
    filename: str,
    mime_type: str,
    content_md: str = "",
    conversation_id: str | None = None,
    source_size: int = 0,
    source_mime_type: str | None = None,
    asset_id: str | None = None,
    source_revision_id: str | None = None,
    source_sha256: str | None = None,
    source_filename: str | None = None,
    conversion_provider_id: str | None = None,
    ingest_status: str = "ready",
    ingest_progress: int = 100,
    ingest_error: str | None = None,
    document_id: str | None = None,
) -> DocumentRow:
    now = datetime.now(UTC)
    row = DocumentRow(
        id=document_id or new_document_id(),
        user_id=user_id,
        workspace_id=workspace_id,
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        kind=kind,
        title=title[:255],
        filename=filename[:255],
        mime_type=mime_type,
        content_md=content_md,
        source_size=source_size,
        source_mime_type=source_mime_type,
        asset_id=asset_id,
        source_revision_id=source_revision_id,
        source_sha256=source_sha256,
        source_filename=source_filename,
        conversion_provider_id=conversion_provider_id,
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
    uploader + workspace from the row itself)."""
    row = await session.scalar(select(DocumentRow).where(DocumentRow.id == document_id))
    return row


async def get_workspace_document(
    session: AsyncSession, document_id: str, workspace_id: str, tenant_id: str
) -> DocumentRow | None:
    """Team-scoped read: any member of the owning workspace may access the document."""
    row = await session.scalar(
        select(DocumentRow).where(
            DocumentRow.id == document_id,
            (DocumentRow.workspace_id == workspace_id) & (DocumentRow.tenant_id == tenant_id),
        )
    )
    return row


async def list_documents(
    session: AsyncSession, *, user_id: str, conversation_id: str | None = None, kind: str | None = None
) -> list[DocumentRow]:
    stmt = select(DocumentRow).where(DocumentRow.user_id == user_id).order_by(DocumentRow.created_at.desc())
    if conversation_id:
        stmt = stmt.where(DocumentRow.conversation_id == conversation_id)
    if kind:
        stmt = stmt.where(DocumentRow.kind == kind)
    result = await session.scalars(stmt)
    return list(result.all())


async def list_workspace_documents(
    session: AsyncSession, *, workspace_id: str, tenant_id: str, kind: str | None = None
) -> list[DocumentRow]:
    """Team knowledge base: every member sees the workspace's documents."""
    stmt = (
        select(DocumentRow)
        .where((DocumentRow.workspace_id == workspace_id) & (DocumentRow.tenant_id == tenant_id))
        .order_by(DocumentRow.created_at.desc())
    )
    if kind:
        stmt = stmt.where(DocumentRow.kind == kind)
    result = await session.scalars(stmt)
    return list(result.all())


async def list_workspace_documents_by_ids(
    session: AsyncSession, *, workspace_id: str, tenant_id: str, document_ids: list[str]
) -> list[DocumentRow]:
    """Fetch the workspace's documents for the given ids (used by team batch delete)."""
    if not document_ids:
        return []
    stmt = select(DocumentRow).where(
        (DocumentRow.workspace_id == workspace_id) & (DocumentRow.tenant_id == tenant_id),
        DocumentRow.id.in_(document_ids),
    )
    result = await session.scalars(stmt)
    return list(result.all())


async def get_documents_meta(session: AsyncSession, document_ids: list[str]) -> dict[str, tuple[str, str]]:
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
    session: AsyncSession, row: DocumentRow, values: dict[str, Any], *, expected_updated_at: datetime
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


async def apply_conversion_if_unchanged(
    session: AsyncSession, document_id: str, values: dict[str, Any], *, expected_updated_at: datetime
) -> bool:
    """Apply derived conversion state only while the source revision is current.

    Conversion output belongs to the captured source revision, so this write must
    neither overwrite a newer edit nor create a new revision of its own.
    """
    result = cast(
        CursorResult[Any],
        await session.execute(
            update(DocumentRow)
            .where(DocumentRow.id == document_id, DocumentRow.updated_at == expected_updated_at)
            .values(**values)
        ),
    )
    return result.rowcount == 1


async def find_converted_cache(
    session: AsyncSession,
    *,
    source_sha256: str,
    workspace_id: str | None,
    tenant_id: str | None,
    user_id: str,
    exclude_document_id: str,
) -> str | None:
    """Return the converted markdown of an already-``ready`` document with the
    exact same source bytes, so re-uploading an identical file skips a redundant
    MarkItDown pass. Scoped to the same team (or user, when personal) so it never
    crosses a trust boundary. Callers must only use this for deterministic
    (non-media) conversions — vision captions depend on the provider/model, so
    they are intentionally not cached.
    """
    stmt = (
        select(DocumentRow.content_md)
        .where(
            DocumentRow.source_sha256 == source_sha256,
            DocumentRow.id != exclude_document_id,
            DocumentRow.ingest_status == "ready",
            DocumentRow.content_md != "",
        )
        .limit(1)
    )
    stmt = (
        stmt.where((DocumentRow.workspace_id == workspace_id) & (DocumentRow.tenant_id == tenant_id))
        if workspace_id
        else stmt.where(DocumentRow.user_id == user_id)
    )
    return cast("str | None", await session.scalar(stmt))


async def set_index_status(session: AsyncSession, document_id: str, *, status: str, error: str | None = None) -> None:
    """Write the async-indexing lifecycle state without touching ``updated_at``.

    Indexing is a background side effect, not a content edit, so it must not
    reorder the document list's "updated time" column.
    """
    await session.execute(
        update(DocumentRow).where(DocumentRow.id == document_id).values(index_status=status, index_error=error)
    )


async def set_ingest_status(
    session: AsyncSession, document_id: str, *, status: str, progress: int, error: str | None = None
) -> None:
    """Write conversion lifecycle state without changing the content revision."""
    await session.execute(
        update(DocumentRow)
        .where(DocumentRow.id == document_id)
        .values(ingest_status=status, ingest_progress=progress, ingest_error=error)
    )


async def delete_document(session: AsyncSession, row: DocumentRow) -> None:
    await session.delete(row)
    await session.flush()
