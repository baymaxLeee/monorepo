"""Internal document API for chat and other services."""

import base64
import binascii
from datetime import datetime
from hashlib import sha256

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from kernel.errors import ConflictError, NotFoundError, RequestError
from knowledge.crud import documents as document_crud
from knowledge.deps import DbSession, require_internal_token
from knowledge.schemas.document import (
    CreateArtifactInput,
    CreateMediaDocumentInput,
    Document,
    DocumentSlice,
    UpdateArtifactInput,
)
from knowledge.services.documents import document_to_schema
from knowledge.services.object_store import ObjectStore
from sqlalchemy.exc import IntegrityError

router = APIRouter(
    prefix="/internal",
    tags=["internal"],
    dependencies=[Depends(require_internal_token)],
)


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
    document_id: str,
    session: DbSession,
    user_id: str = Query(...),
) -> Document:
    row = await document_crud.get_document(session, document_id, user_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    return document_to_schema(row, include_content=True)


@router.get("/documents/{document_id}/slice", response_model=DocumentSlice)
async def get_document_slice(
    document_id: str,
    session: DbSession,
    user_id: str = Query(...),
    start: int = Query(default=0, ge=0),
    max_chars: int = Query(default=4000, ge=1, le=8000),
) -> DocumentSlice:
    row = await document_crud.get_document(session, document_id, user_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
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
    )


@router.get("/documents/{document_id}/source")
async def get_document_source(
    document_id: str,
    session: DbSession,
    user_id: str = Query(...),
) -> Response:
    row = await document_crud.get_document(session, document_id, user_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    if not row.object_bucket or not row.object_key:
        raise NotFoundError("document has no stored source object")
    content = ObjectStore().get_bytes(bucket=row.object_bucket, key=row.object_key)
    media = row.source_mime_type or "application/octet-stream"
    return Response(content=content, media_type=media)


@router.post("/artifacts", response_model=Document, status_code=201)
async def create_artifact(payload: CreateArtifactInput, session: DbSession) -> Document:
    mime = payload.mime_type or (
        "text/html" if payload.filename.lower().endswith((".html", ".htm")) else "text/markdown"
    )
    document_id = None
    if payload.idempotency_key:
        document_id = sha256(
            f"{payload.user_id}:{payload.conversation_id or ''}:{payload.idempotency_key}".encode()
        ).hexdigest()[:16]
        existing = await document_crud.get_document(session, document_id, payload.user_id)
        if existing is not None:
            return document_to_schema(existing, include_content=True)
    try:
        row = await document_crud.create_document(
            session,
            user_id=payload.user_id,
            conversation_id=payload.conversation_id,
            kind="artifact",
            title=payload.title,
            filename=payload.filename,
            mime_type=mime,
            content_md=payload.content,
            ingest_status="ready",
            ingest_progress=100,
            document_id=document_id,
        )
        await session.commit()
    except IntegrityError:
        if document_id is None:
            raise
        await session.rollback()
        existing = await document_crud.get_document(session, document_id, payload.user_id)
        if existing is None:
            raise
        return document_to_schema(existing, include_content=True)
    return document_to_schema(row, include_content=True)


@router.post("/media-documents", response_model=Document, status_code=201)
async def create_media_document(payload: CreateMediaDocumentInput, session: DbSession) -> Document:
    """Persist agent-generated binary media (e.g. a generated image) as a document.

    Mirrors the artifact-publish path: bytes go into the object store and the
    document row records ``object_bucket``/``object_key`` so the existing
    ``/documents/{id}/source`` route serves them. Idempotent on
    ``idempotency_key`` (typically the tool-call id) so a retried generation
    reuses the same document instead of duplicating storage."""
    document_id = None
    if payload.idempotency_key:
        document_id = sha256(
            f"{payload.user_id}:{payload.conversation_id or ''}:{payload.idempotency_key}".encode()
        ).hexdigest()[:16]
        existing = await document_crud.get_document(session, document_id, payload.user_id)
        if existing is not None:
            return document_to_schema(existing, include_content=True)
    try:
        raw = base64.b64decode(payload.data_base64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise RequestError("invalid base64 media payload") from exc
    if not raw:
        raise RequestError("empty media payload")
    stored = ObjectStore().put_bytes(
        content=raw,
        filename=payload.filename,
        mime_type=payload.mime_type,
        user_id=payload.user_id,
        prefix=f"media/{payload.conversation_id or 'general'}",
    )
    try:
        row = await document_crud.create_document(
            session,
            user_id=payload.user_id,
            conversation_id=payload.conversation_id,
            kind="artifact",
            title=payload.title,
            filename=payload.filename,
            mime_type=payload.mime_type,
            content_md="",
            source_size=stored.size,
            source_mime_type=payload.mime_type,
            object_bucket=stored.bucket,
            object_key=stored.key,
            object_sha256=stored.sha256,
            ingest_status="ready",
            ingest_progress=100,
            document_id=document_id,
        )
        await session.commit()
    except IntegrityError:
        if document_id is None:
            raise
        await session.rollback()
        existing = await document_crud.get_document(session, document_id, payload.user_id)
        if existing is None:
            raise
        return document_to_schema(existing, include_content=True)
    return document_to_schema(row, include_content=True)


@router.patch("/documents/{document_id}", response_model=Document)
async def update_artifact(
    document_id: str,
    payload: UpdateArtifactInput,
    session: DbSession,
) -> Document:
    row = await document_crud.get_document(session, document_id, payload.user_id)
    if row is None or row.kind != "artifact":
        raise NotFoundError(f"artifact {document_id} not found")
    values = payload.model_dump(exclude_unset=True, exclude_none=True)
    values.pop("user_id", None)
    expected_updated_at_raw = values.pop("expected_updated_at", None)
    if "content" in values:
        values["content_md"] = values.pop("content")
    if values:
        if expected_updated_at_raw:
            try:
                expected_updated_at = datetime.fromisoformat(expected_updated_at_raw.replace("Z", "+00:00"))
            except ValueError as exc:
                raise ConflictError("invalid artifact base version") from exc
            updated = await document_crud.update_document_if_unchanged(
                session,
                row,
                values,
                expected_updated_at=expected_updated_at,
            )
            if updated is None:
                raise ConflictError("artifact changed while the revision was being generated")
            row = updated
        else:
            row = await document_crud.update_document(session, row, values)
        await session.commit()
    return document_to_schema(row, include_content=True)


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(
    document_id: str,
    session: DbSession,
    user_id: str = Query(...),
) -> None:
    row = await document_crud.get_document(session, document_id, user_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    if row.object_bucket and row.object_key:
        ObjectStore().delete(bucket=row.object_bucket, key=row.object_key)
    await document_crud.delete_document(session, row)
    await session.commit()
