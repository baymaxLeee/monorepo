"""User-facing document management (future knowledge app)."""

from fastapi import APIRouter, Query
from fastapi.responses import Response
from kernel.errors import ForbiddenError, NotFoundError
from knowledge.crud import documents as document_crud
from knowledge.deps import AuthContext, CurrentUser, DbSession
from knowledge.models.document import DocumentRow
from knowledge.schemas.document import Document
from knowledge.services.documents import document_to_schema
from knowledge.services.indexing import index_document
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
    rows = await document_crud.list_org_documents_by_ids(
        session, org_id=current_user.org_id, document_ids=unique_ids
    )
    by_id = {row.id: row for row in rows}
    for doc_id in unique_ids:
        row = by_id.get(doc_id)
        if row is None or not _may_manage(current_user, row):
            raise ForbiddenError("you may only delete your own documents")
    store = ObjectStore()
    for row in rows:
        if row.object_bucket and row.object_key:
            store.delete(bucket=row.object_bucket, key=row.object_key)
        await document_crud.delete_document(session, row)
    await session.commit()
    return BatchDeleteResult(requested=len(payload.ids), deleted=len(rows))


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
    row = await document_crud.get_org_document(session, document_id, current_user.org_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    if not _may_manage(current_user, row):
        raise ForbiddenError("you may only update your own documents")
    values = payload.model_dump(exclude_unset=True, exclude_none=True)
    if values:
        row = await document_crud.update_document(session, row, values)
        await session.commit()
        if "content_md" in values:
            try:
                await index_document(session, document_id=row.id)
            except Exception as exc:
                print(f"[knowledge] reindex failed for {row.id}: {exc}")
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
    row = await document_crud.get_org_document(session, document_id, current_user.org_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    if not _may_manage(current_user, row):
        raise ForbiddenError("you may only delete your own documents")
    if row.object_bucket and row.object_key:
        ObjectStore().delete(bucket=row.object_bucket, key=row.object_key)
    await document_crud.delete_document(session, row)
    await session.commit()


def _may_manage(current_user: AuthContext, row: DocumentRow) -> bool:
    """An org_admin manages any org doc; a member manages only their uploads."""
    return current_user.is_org_admin or row.user_id == current_user.user_id
