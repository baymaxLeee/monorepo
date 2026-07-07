"""User-facing document management (future knowledge app)."""

from fastapi import APIRouter, Query
from fastapi.responses import Response
from kernel.errors import ForbiddenError, NotFoundError
from knowledge.crud import documents as document_crud
from knowledge.db import write_tx
from knowledge.deps import AuthContext, CurrentUser, DbSession
from knowledge.models.document import DocumentRow
from knowledge.schemas.document import Document
from knowledge.services.documents import document_to_schema
from knowledge.services.indexer import schedule_index
from knowledge.services.object_store import ObjectStore
from pydantic import BaseModel, Field

router = APIRouter(prefix="/documents", tags=["documents"])


class UpdateDocumentInput(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content_md: str | None = Field(default=None, min_length=1)


class BatchDeleteInput(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=200)


class BatchDeleteResult(BaseModel):
    requested: int
    deleted: int


@router.get("", response_model=list[Document])
async def list_my_documents(
    current_user: CurrentUser,
    session: DbSession,
    kind: str | None = Query(default=None),
) -> list[Document]:
    rows = await document_crud.list_org_documents(session, org_id=current_user.org_id, kind=kind)
    return [document_to_schema(row) for row in rows]


@router.post("/batch-delete", response_model=BatchDeleteResult)
async def batch_delete_my_documents(
    payload: BatchDeleteInput,
    current_user: CurrentUser,
    session: DbSession,
) -> BatchDeleteResult:
    """Delete several documents in one transaction.

    Same policy as single delete: an org_admin may delete any of the org's
    documents; a member may delete only their own uploads. If ANY requested id
    is outside the org or not deletable by the caller, the whole batch is
    rejected with 403 — no silent partial success that would mislead the caller.
    Object-store blobs are best-effort purged and RAG `document_chunks` drop via
    the FK `ON DELETE CASCADE`.
    """
    unique_ids = list(dict.fromkeys(payload.ids))
    async with write_tx(session):
        rows = await document_crud.list_org_documents_by_ids(
            session, org_id=current_user.org_id, document_ids=unique_ids
        )
        by_id = {row.id: row for row in rows}
        for doc_id in unique_ids:
            row = by_id.get(doc_id)
            if row is None or not _may_manage(current_user, row):
                raise ForbiddenError("you may only delete your own documents")
        # Capture blob refs before the rows are gone; object purge is a best-effort
        # side effect that runs AFTER the DB delete commits (a failed purge only
        # orphans blobs, never leaves rows pointing at deleted objects).
        object_refs = [(r.object_bucket, r.object_key) for r in rows if r.object_bucket and r.object_key]
        for row in rows:
            await document_crud.delete_document(session, row)
        deleted = len(rows)
    store = ObjectStore()
    for bucket, key in object_refs:
        store.delete(bucket=bucket, key=key)
    return BatchDeleteResult(requested=len(payload.ids), deleted=deleted)


@router.get("/{document_id}", response_model=Document)
async def get_my_document(
    document_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> Document:
    row = await document_crud.get_org_document(session, document_id, current_user.org_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    return document_to_schema(row, include_content=True)


@router.patch("/{document_id}", response_model=Document)
async def update_my_document(
    document_id: str,
    payload: UpdateDocumentInput,
    current_user: CurrentUser,
    session: DbSession,
) -> Document:
    async with write_tx(session):
        row = await document_crud.get_org_document(session, document_id, current_user.org_id)
        if row is None:
            raise NotFoundError(f"document {document_id} not found")
        if not _may_manage(current_user, row):
            raise ForbiddenError("you may only update your own documents")
        values = payload.model_dump(exclude_unset=True, exclude_none=True)
        content_changed = "content_md" in values
        if values:
            if content_changed:
                values["index_status"] = "pending"
            row = await document_crud.update_document(session, row, values)
    if values and content_changed:
        schedule_index(row.id)
    return document_to_schema(row, include_content=True)


@router.post("/{document_id}/reindex", response_model=Document)
async def reindex_my_document(
    document_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> Document:
    """Re-queue a document for background RAG indexing (retry a skipped/failed
    index, or rebuild after provider changes)."""
    async with write_tx(session):
        row = await document_crud.get_org_document(session, document_id, current_user.org_id)
        if row is None:
            raise NotFoundError(f"document {document_id} not found")
        if not _may_manage(current_user, row):
            raise ForbiddenError("you may only reindex your own documents")
        await document_crud.set_index_status(session, row.id, status="pending")
    schedule_index(row.id)
    row = await document_crud.get_org_document(session, document_id, current_user.org_id)
    assert row is not None
    return document_to_schema(row, include_content=True)


@router.get("/{document_id}/source")
async def get_my_document_source(
    document_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> Response:
    row = await document_crud.get_org_document(session, document_id, current_user.org_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    if not row.object_bucket or not row.object_key:
        raise NotFoundError("document has no stored source object")
    content = ObjectStore().get_bytes(bucket=row.object_bucket, key=row.object_key)
    media = row.source_mime_type or "application/octet-stream"
    return Response(content=content, media_type=media)


@router.delete("/{document_id}", status_code=204)
async def delete_my_document(
    document_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> None:
    async with write_tx(session):
        row = await document_crud.get_org_document(session, document_id, current_user.org_id)
        if row is None:
            raise NotFoundError(f"document {document_id} not found")
        if not _may_manage(current_user, row):
            raise ForbiddenError("you may only delete your own documents")
        object_ref = (
            (row.object_bucket, row.object_key) if row.object_bucket and row.object_key else None
        )
        await document_crud.delete_document(session, row)
    if object_ref is not None:
        ObjectStore().delete(bucket=object_ref[0], key=object_ref[1])


def _may_manage(current_user: AuthContext, row: DocumentRow) -> bool:
    """An org_admin manages any org doc; a member manages only their uploads."""
    return current_user.is_org_admin or row.user_id == current_user.user_id
