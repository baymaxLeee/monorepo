"""User-facing document management (future knowledge app)."""

from fastapi import APIRouter, Query
from fastapi.responses import Response
from kernel.errors import NotFoundError
from knowledge.crud import documents as document_crud
from knowledge.deps import CurrentUser, DbSession
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
    rows = await document_crud.list_documents(session, user_id=current_user.user_id, kind=kind)
    return [document_to_schema(row) for row in rows]


@router.post("/batch-delete", response_model=BatchDeleteResult)
async def batch_delete_my_documents(
    payload: BatchDeleteInput,
    current_user: CurrentUser,
    session: DbSession,
) -> BatchDeleteResult:
    """Delete several of the caller's documents in one transaction.

    Only rows owned by the current user are removed (ids the user does not own
    are silently ignored). Object-store blobs are best-effort purged and the
    RAG `document_chunks` are dropped via the FK `ON DELETE CASCADE`.
    """
    rows = await document_crud.list_documents_by_ids(
        session, user_id=current_user.user_id, document_ids=payload.ids
    )
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
    row = await document_crud.get_document(session, document_id, current_user.user_id)
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
    row = await document_crud.get_document(session, document_id, current_user.user_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    values = payload.model_dump(exclude_unset=True, exclude_none=True)
    if values:
        row = await document_crud.update_document(session, row, values)
        await session.commit()
        # Keep the RAG index fresh when the document body changes (时效性).
        if "content_md" in values:
            try:
                await index_document(session, document_id=row.id, user_id=current_user.user_id)
            except Exception as exc:
                print(f"[knowledge] reindex failed for {row.id}: {exc}")
    return document_to_schema(row, include_content=True)


@router.get("/{document_id}/source")
async def get_my_document_source(
    document_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> Response:
    row = await document_crud.get_document(session, document_id, current_user.user_id)
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
    row = await document_crud.get_document(session, document_id, current_user.user_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    if row.object_bucket and row.object_key:
        ObjectStore().delete(bucket=row.object_bucket, key=row.object_key)
    await document_crud.delete_document(session, row)
    await session.commit()
