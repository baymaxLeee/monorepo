"""Internal document API for chat and other services."""

import asyncio
import time
from datetime import datetime
from hashlib import sha256

from application.contracts.document import (
    CreateMediaDocumentInput,
    CreateStagedMediaInput,
    Document,
    DocumentSlice,
    StagedMedia,
    StagedMediaActionInput,
    UpdateArtifactInput,
)
from application.conversation_cleanup import assert_conversation_accepts_artifacts
from application.document_edits import apply_document_edit
from application.documents import document_to_schema
from application.indexer import index_document_by_id
from application.processor import convert_document
from application.storage_client import (
    ensure_document_claim_active,
    ensure_staged_media_claim_active,
    get_storage_client,
    mark_document_claim_released,
    mark_staged_media_claim_released,
)
from fastapi import APIRouter, Depends, Query
from infrastructure.persistence.database import write_tx
from infrastructure.persistence.models.document import DocumentRow
from infrastructure.persistence.models.staged_media import StagedMediaRow
from infrastructure.persistence.repositories import documents as document_crud
from infrastructure.persistence.repositories import staged_media as staged_media_crud
from kernel.errors import ConflictError, NotFoundError, RequestError
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from api.http.dependencies import DbSession, require_executor_caller, require_internal_token

router = APIRouter(prefix="/internal", tags=["internal"], dependencies=[Depends(require_internal_token)])


class DocumentProcessResult(BaseModel):
    state: str


class ProcessDocumentInput(BaseModel):
    provider_id: str | None = None


@router.post(
    "/documents/{document_id}/process",
    response_model=DocumentProcessResult,
    dependencies=[Depends(require_executor_caller)],
)
async def process_document(document_id: str, payload: ProcessDocumentInput) -> DocumentProcessResult:
    return DocumentProcessResult(state=await convert_document(document_id, provider_id=payload.provider_id))


@router.post(
    "/documents/{document_id}/index",
    response_model=DocumentProcessResult,
    dependencies=[Depends(require_executor_caller)],
)
async def index_document(document_id: str) -> DocumentProcessResult:
    return DocumentProcessResult(state=await index_document_by_id(document_id))


def staged_media_to_schema(row: StagedMediaRow) -> StagedMedia:
    return StagedMedia(
        id=row.id,
        user_id=row.user_id,
        workspace_id=row.workspace_id,
        tenant_id=row.tenant_id,
        conversation_id=row.conversation_id,
        title=row.title,
        filename=row.filename,
        mime_type=row.mime_type,
        size=row.size,
        asset_id=row.asset_id or "",
        revision_id=row.revision_id or "",
        sha256=row.asset_sha256 or "",
        status=row.status,  # type: ignore[arg-type]
        document_id=row.document_id,
        created_at=row.created_at.isoformat(),
        updated_at=row.updated_at.isoformat(),
    )


def _validate_staged_media_replay(row: StagedMediaRow, payload: CreateStagedMediaInput) -> None:
    if row.asset_id != payload.asset_id or row.revision_id != payload.revision_id:
        raise ConflictError("idempotency key is already bound to a different Storage revision")


async def _find_staged_media_replay(session: DbSession, payload: CreateStagedMediaInput) -> StagedMediaRow | None:
    if not payload.idempotency_key:
        return None
    row = await staged_media_crud.get_by_idempotency_key(
        session,
        idempotency_key=payload.idempotency_key,
        user_id=payload.user_id,
        tenant_id=payload.tenant_id,
        workspace_id=payload.workspace_id,
        conversation_id=payload.conversation_id,
    )
    if row is not None:
        _validate_staged_media_replay(row, payload)
    return row


@router.get("/documents", response_model=list[Document])
async def list_documents(
    session: DbSession,
    user_id: str = Query(...),
    conversation_id: str | None = Query(default=None),
    kind: str | None = Query(default=None),
) -> list[Document]:
    rows = await document_crud.list_documents(session, user_id=user_id, conversation_id=conversation_id, kind=kind)
    return [document_to_schema(row) for row in rows]


@router.get("/documents/{document_id}", response_model=Document)
async def get_document(
    document_id: str, session: DbSession, user_id: str = Query(...), include_content: bool = Query(default=True)
) -> Document:
    row = await document_crud.get_document(session, document_id, user_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    return document_to_schema(row, include_content=include_content)


@router.get("/workspaces/{workspace_id}/documents/{document_id}", response_model=Document)
async def get_workspace_document(
    workspace_id: str,
    document_id: str,
    session: DbSession,
    tenant_id: str = Query(..., min_length=1, max_length=26),
    include_content: bool = Query(default=False),
) -> Document:
    """Resolve a retrieval source under the authoritative workspace ACL.

    Chat separately proves that the source id occurs in the selected journal;
    this endpoint only answers the owning service's tenant/workspace question.
    """
    row = await document_crud.get_workspace_document(session, document_id, workspace_id, tenant_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    return document_to_schema(row, include_content=include_content)


_SLICE_WAIT_MAX_MS = 120000
_SLICE_POLL_INTERVAL_S = 0.5


def _ready_slice(row: DocumentRow, start: int, max_chars: int) -> DocumentSlice:
    content = row.content_md
    chunk = content[start : start + max_chars]
    next_start = start + len(chunk) if start + len(chunk) < len(content) else None
    return DocumentSlice(
        id=row.id,
        title=row.title,
        filename=row.filename,
        mime_type=row.mime_type,
        content=chunk,
        start=start,
        total_chars=len(content),
        next_start=next_start,
        state="ready",
    )


@router.get("/documents/{document_id}/slice", response_model=DocumentSlice)
async def get_document_slice(
    document_id: str,
    session: DbSession,
    user_id: str = Query(...),
    start: int = Query(default=0, ge=0),
    max_chars: int = Query(default=4000, ge=1, le=8000),
    wait_ms: int = Query(default=0, ge=0, le=_SLICE_WAIT_MAX_MS),
) -> DocumentSlice:
    """Read a bounded slice of the converted markdown. When the document is still
    converting in the background, ``wait_ms`` long-polls until it is ``ready`` (or
    ``failed``/timeout) so a caller that just uploaded can read as soon as convert
    finishes instead of getting an empty body. ``state`` distinguishes the outcome:
    ``ready`` (real content), ``processing`` (retry later), ``failed`` (see error).
    """
    deadline = time.monotonic() + wait_ms / 1000
    while True:
        row = await document_crud.get_document(session, document_id, user_id)
        if row is None:
            raise NotFoundError(f"document {document_id} not found")
        if row.content_md or row.ingest_status == "ready":
            return _ready_slice(row, start, max_chars)
        if row.ingest_status == "failed":
            return DocumentSlice(
                id=row.id,
                title=row.title,
                filename=row.filename,
                mime_type=row.mime_type,
                content="",
                start=start,
                total_chars=0,
                state="failed",
                error=row.ingest_error,
            )
        if wait_ms <= 0 or time.monotonic() >= deadline:
            return DocumentSlice(
                id=row.id,
                title=row.title,
                filename=row.filename,
                mime_type=row.mime_type,
                content="",
                start=start,
                total_chars=0,
                state="processing",
            )
        await session.rollback()
        await asyncio.sleep(_SLICE_POLL_INTERVAL_S)


@router.post("/media-documents", response_model=Document, status_code=201)
async def create_media_document(payload: CreateMediaDocumentInput, session: DbSession) -> Document:
    """Register agent-generated media already persisted by Asset."""
    document_id = None
    if payload.idempotency_key:
        document_id = sha256(
            f"{payload.workspace_id}:{payload.user_id}:{payload.conversation_id or ''}:{payload.idempotency_key}".encode()
        ).hexdigest()[:16]
        async with write_tx(session):
            await assert_conversation_accepts_artifacts(
                session, user_id=payload.user_id, conversation_id=payload.conversation_id
            )
            existing = await document_crud.get_document(session, document_id, payload.user_id)
        if existing is not None:
            return document_to_schema(existing, include_content=True)
    asset = await get_storage_client().describe(
        tenant_id=payload.tenant_id,
        workspace_id=payload.workspace_id,
        asset_id=payload.asset_id,
        revision_id=payload.revision_id,
    )
    if asset.created_by != payload.user_id:
        raise RequestError("asset was not created for the requested user")
    if not asset.media_type.startswith(("image/", "audio/", "video/")):
        raise RequestError("media documents accept only image, audio, or video revisions")
    storage_document_id = document_id or document_crud.new_document_id()
    try:
        async with write_tx(session):
            await assert_conversation_accepts_artifacts(
                session, user_id=payload.user_id, conversation_id=payload.conversation_id
            )
            if document_id is not None:
                existing = await document_crud.get_document(session, document_id, payload.user_id)
                if existing is not None:
                    return document_to_schema(existing, include_content=True)
            row = await document_crud.create_document(
                session,
                user_id=payload.user_id,
                workspace_id=payload.workspace_id,
                tenant_id=payload.tenant_id,
                conversation_id=payload.conversation_id,
                kind="artifact",
                title=payload.title,
                filename=asset.filename,
                mime_type=asset.media_type,
                content_md="",
                source_size=asset.size_bytes,
                source_mime_type=asset.media_type,
                asset_id=asset.asset_id,
                source_revision_id=asset.revision_id,
                source_sha256=asset.sha256,
                ingest_status="ready",
                ingest_progress=100,
                document_id=document_id or storage_document_id,
            )
            await ensure_document_claim_active(
                session,
                tenant_id=payload.tenant_id,
                workspace_id=payload.workspace_id,
                document_id=row.id,
                asset_id=asset.asset_id,
                revision_id=asset.revision_id,
            )
    except IntegrityError:
        if document_id is None:
            raise
        existing = await document_crud.get_document(session, document_id, payload.user_id)
        if existing is None:
            raise
        return document_to_schema(existing, include_content=True)
    return document_to_schema(row, include_content=True)


@router.post("/staged-media", response_model=StagedMedia, status_code=201)
async def create_staged_media(payload: CreateStagedMediaInput, session: DbSession) -> StagedMedia:
    if payload.idempotency_key:
        async with write_tx(session):
            await assert_conversation_accepts_artifacts(
                session, user_id=payload.user_id, conversation_id=payload.conversation_id
            )
            existing = await _find_staged_media_replay(session, payload)
        if existing is not None:
            return staged_media_to_schema(existing)
    asset = await get_storage_client().describe(
        tenant_id=payload.tenant_id,
        workspace_id=payload.workspace_id,
        asset_id=payload.asset_id,
        revision_id=payload.revision_id,
    )
    if asset.created_by != payload.user_id:
        raise RequestError("asset was not created for the requested user")
    staged_id = document_crud.new_document_id()
    try:
        async with write_tx(session):
            await assert_conversation_accepts_artifacts(
                session, user_id=payload.user_id, conversation_id=payload.conversation_id
            )
            if payload.idempotency_key:
                existing = await _find_staged_media_replay(session, payload)
                if existing is not None:
                    return staged_media_to_schema(existing)
            row = await staged_media_crud.create_staged_media(
                session,
                staged_id=staged_id,
                user_id=payload.user_id,
                workspace_id=payload.workspace_id,
                tenant_id=payload.tenant_id,
                conversation_id=payload.conversation_id,
                title=asset.filename,
                filename=asset.filename,
                mime_type=asset.media_type,
                size=asset.size_bytes,
                asset_id=asset.asset_id,
                revision_id=asset.revision_id,
                asset_sha256=asset.sha256,
                idempotency_key=payload.idempotency_key,
            )
            await ensure_staged_media_claim_active(
                session,
                tenant_id=row.tenant_id,
                workspace_id=row.workspace_id,
                staged_id=row.id,
                asset_id=asset.asset_id,
                revision_id=asset.revision_id,
            )
    except IntegrityError:
        if not payload.idempotency_key:
            raise
        existing = await _find_staged_media_replay(session, payload)
        if existing is None:
            raise
        return staged_media_to_schema(existing)
    return staged_media_to_schema(row)


@router.get("/staged-media/{staged_id}", response_model=StagedMedia)
async def get_staged_media(staged_id: str, session: DbSession, user_id: str = Query(...)) -> StagedMedia:
    row = await staged_media_crud.get_staged_media(session, staged_id, user_id)
    if row is None:
        raise NotFoundError(f"staged media {staged_id} not found")
    return staged_media_to_schema(row)


@router.post("/staged-media/{staged_id}/publish", response_model=Document)
async def publish_staged_media(staged_id: str, payload: StagedMediaActionInput, session: DbSession) -> Document:
    async with write_tx(session):
        row = await staged_media_crud.get_staged_media(session, staged_id, payload.user_id)
        if row is None or row.workspace_id != payload.workspace_id or row.status == "discarded":
            raise NotFoundError(f"staged media {staged_id} not found")
        if row.document_id:
            existing = await document_crud.get_document(session, row.document_id, payload.user_id)
            if existing is None:
                raise ConflictError("published staged media has no document")
            return document_to_schema(existing, include_content=True)
        await assert_conversation_accepts_artifacts(session, user_id=row.user_id, conversation_id=row.conversation_id)
        document = await document_crud.create_document(
            session,
            user_id=row.user_id,
            workspace_id=row.workspace_id,
            tenant_id=row.tenant_id,
            conversation_id=row.conversation_id,
            kind="artifact",
            title=row.title,
            filename=row.filename,
            mime_type=row.mime_type,
            source_size=row.size,
            source_mime_type=row.mime_type,
            asset_id=row.asset_id,
            source_revision_id=row.revision_id,
            source_sha256=row.asset_sha256,
            ingest_status="ready",
            ingest_progress=100,
        )
        if not row.asset_id or not row.revision_id:
            raise ConflictError("staged media has no Asset revision")
        await ensure_document_claim_active(
            session,
            tenant_id=row.tenant_id,
            workspace_id=row.workspace_id,
            document_id=document.id,
            asset_id=row.asset_id,
            revision_id=row.revision_id,
        )
        await mark_staged_media_claim_released(
            session, tenant_id=row.tenant_id, workspace_id=row.workspace_id, staged_id=row.id
        )
        row.status = "published"
        row.document_id = document.id
        row.updated_at = datetime.now(row.updated_at.tzinfo)
        await session.flush()
    return document_to_schema(document, include_content=True)


@router.post("/staged-media/{staged_id}/discard", response_model=StagedMedia)
async def discard_staged_media(staged_id: str, payload: StagedMediaActionInput, session: DbSession) -> StagedMedia:
    async with write_tx(session):
        row = await staged_media_crud.get_staged_media(session, staged_id, payload.user_id)
        if row is None or row.workspace_id != payload.workspace_id:
            raise NotFoundError(f"staged media {staged_id} not found")
        if row.status == "published":
            raise ConflictError("published staged media cannot be discarded")
        if row.status != "discarded":
            await mark_staged_media_claim_released(
                session, tenant_id=row.tenant_id, workspace_id=row.workspace_id, staged_id=row.id
            )
            row.status = "discarded"
            row.updated_at = datetime.now(row.updated_at.tzinfo)
            await session.flush()
    return staged_media_to_schema(row)


@router.patch("/documents/{document_id}", response_model=Document)
async def update_artifact(document_id: str, payload: UpdateArtifactInput, session: DbSession) -> Document:
    async with write_tx(session):
        row = await document_crud.get_document(session, document_id, payload.user_id)
        if row is None or row.kind != "artifact":
            raise NotFoundError(f"artifact {document_id} not found")
        values = payload.model_dump(exclude_unset=True, exclude_none=True)
        values.pop("user_id", None)
        expected_raw = values.pop("expected_updated_at", None)
        if "content" in values:
            if not row.editable_source:
                raise ConflictError("immutable artifacts require a new snapshot")
            values["content_md"] = values.pop("content")
    expected = None
    if expected_raw:
        try:
            expected = datetime.fromisoformat(expected_raw.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ConflictError("invalid artifact base version") from exc
    if values:
        row = await apply_document_edit(session, row, values, expected_updated_at=expected)
    return document_to_schema(row, include_content=True)


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(document_id: str, session: DbSession, user_id: str = Query(...)) -> None:
    async with write_tx(session):
        row = await document_crud.get_document(session, document_id, user_id)
        if row is None:
            raise NotFoundError(f"document {document_id} not found")
        if row.asset_id:
            await mark_document_claim_released(
                session, tenant_id=row.tenant_id or "", workspace_id=row.workspace_id or "", document_id=row.id
            )
        await document_crud.delete_document(session, row)
