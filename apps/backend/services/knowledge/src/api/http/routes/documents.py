"""User-facing document management (future knowledge app)."""

from application.asset_client import get_asset_client, mark_document_claim_released
from application.auth import AuthContext
from application.contracts.document import Document
from application.documents import document_to_schema
from application.executor_client import dispatch_document_now
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from infrastructure.persistence.database import write_tx
from infrastructure.persistence.models.document import DocumentRow
from infrastructure.persistence.repositories import documents as document_crud
from kernel.errors import ForbiddenError, NotFoundError
from pydantic import BaseModel, Field

from api.http.dependencies import CurrentUser, DbSession

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
    current_user: CurrentUser, session: DbSession, kind: str | None = Query(default=None)
) -> list[Document]:
    rows = await document_crud.list_workspace_documents(
        session, workspace_id=current_user.workspace_id, tenant_id=current_user.tenant_id, kind=kind
    )
    return [document_to_schema(row) for row in rows]


@router.post("/batch-delete", response_model=BatchDeleteResult)
async def batch_delete_my_documents(
    payload: BatchDeleteInput, current_user: CurrentUser, session: DbSession
) -> BatchDeleteResult:
    """Delete several documents in one transaction.

    Same policy as single delete: an workspace_admin may delete any of the workspace's
    documents; a member may delete only their own uploads. If ANY requested id
    is outside the workspace or not deletable by the caller, the whole batch is
    rejected with 403 — no silent partial success that would mislead the caller.
    Object-store blobs are best-effort purged and RAG `document_chunks` drop via
    the FK `ON DELETE CASCADE`.
    """
    unique_ids = list(dict.fromkeys(payload.ids))
    async with write_tx(session):
        rows = await document_crud.list_workspace_documents_by_ids(
            session, workspace_id=current_user.workspace_id, tenant_id=current_user.tenant_id, document_ids=unique_ids
        )
        by_id = {row.id: row for row in rows}
        for doc_id in unique_ids:
            row = by_id.get(doc_id)
            if row is None or not _may_manage(current_user, row):
                raise ForbiddenError("you may only delete your own documents")
        for row in rows:
            if row.asset_id:
                await mark_document_claim_released(
                    session, tenant_id=current_user.tenant_id, workspace_id=current_user.workspace_id, document_id=row.id
                )
            await document_crud.delete_document(session, row)
        deleted = len(rows)
    return BatchDeleteResult(requested=len(payload.ids), deleted=deleted)


@router.get("/{document_id}", response_model=Document)
async def get_my_document(document_id: str, current_user: CurrentUser, session: DbSession) -> Document:
    row = await document_crud.get_workspace_document(
        session, document_id, current_user.workspace_id, current_user.tenant_id
    )
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    return document_to_schema(row, include_content=True)


@router.patch("/{document_id}", response_model=Document)
async def update_my_document(
    document_id: str, payload: UpdateDocumentInput, current_user: CurrentUser, session: DbSession
) -> Document:
    async with write_tx(session):
        row = await document_crud.get_workspace_document(
            session, document_id, current_user.workspace_id, current_user.tenant_id
        )
        if row is None:
            raise NotFoundError(f"document {document_id} not found")
        if not _may_manage(current_user, row):
            raise ForbiddenError("you may only update your own documents")
        values = payload.model_dump(exclude_unset=True, exclude_none=True)
        content_changed = "content_md" in values
        if values:
            if content_changed:
                values["index_status"] = "pending"
                values["ingest_status"] = "ready"
                values["ingest_error"] = None
                values["processing_dispatched_at"] = None
            row = await document_crud.update_document(session, row, values)
    if values and content_changed:
        await dispatch_document_now(
            row.id,
            updated_at=row.updated_at,
        )
    return document_to_schema(row, include_content=True)


@router.post("/{document_id}/reindex", response_model=Document)
async def reindex_my_document(document_id: str, current_user: CurrentUser, session: DbSession) -> Document:
    """Re-queue a document for background RAG indexing (retry a skipped/failed
    index, or rebuild after provider changes)."""
    async with write_tx(session):
        row = await document_crud.get_workspace_document(
            session, document_id, current_user.workspace_id, current_user.tenant_id
        )
        if row is None:
            raise NotFoundError(f"document {document_id} not found")
        if not _may_manage(current_user, row):
            raise ForbiddenError("you may only reindex your own documents")
        row = await document_crud.update_document(
            session,
            row,
            {"index_status": "pending", "index_error": None, "processing_dispatched_at": None},
        )
    await dispatch_document_now(
        row.id,
        updated_at=row.updated_at,
    )
    row = await document_crud.get_workspace_document(
        session, document_id, current_user.workspace_id, current_user.tenant_id
    )
    assert row is not None
    return document_to_schema(row, include_content=True)


@router.get("/{document_id}/source")
async def get_my_document_source(document_id: str, current_user: CurrentUser, session: DbSession) -> StreamingResponse:
    row = await document_crud.get_workspace_document(
        session, document_id, current_user.workspace_id, current_user.tenant_id
    )
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    if not row.asset_id or not row.source_revision_id:
        raise NotFoundError("document has no source Asset revision")
    media = row.source_mime_type or "application/octet-stream"
    chunks, headers = await get_asset_client().open_stream(
        tenant_id=current_user.tenant_id, workspace_id=current_user.workspace_id,
        asset_id=row.asset_id, revision_id=row.source_revision_id,
    )
    return StreamingResponse(
        chunks,
        media_type=media,
        headers={
            "Content-Disposition": f'inline; filename="{row.source_filename or row.filename}"',
            **({"Content-Length": headers["Content-Length"]} if "Content-Length" in headers else {}),
            **({"ETag": headers["ETag"]} if "ETag" in headers else {}),
        },
    )


@router.delete("/{document_id}", status_code=204)
async def delete_my_document(document_id: str, current_user: CurrentUser, session: DbSession) -> None:
    async with write_tx(session):
        row = await document_crud.get_workspace_document(
            session, document_id, current_user.workspace_id, current_user.tenant_id
        )
        if row is None:
            raise NotFoundError(f"document {document_id} not found")
        if not _may_manage(current_user, row):
            raise ForbiddenError("you may only delete your own documents")
        if row.asset_id:
            await mark_document_claim_released(
                session, tenant_id=current_user.tenant_id, workspace_id=current_user.workspace_id, document_id=row.id
            )
        await document_crud.delete_document(session, row)


def _may_manage(current_user: AuthContext, row: DocumentRow) -> bool:
    """An workspace_admin manages any workspace doc; a member manages only their uploads."""
    return current_user.is_workspace_admin or row.user_id == current_user.user_id
