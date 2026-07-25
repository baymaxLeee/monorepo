"""Internal document API for chat and other services."""

import asyncio
import base64
import binascii
import time
from datetime import datetime
from functools import partial
from hashlib import sha256

import anyio
from application.contracts.document import (
    CreateArtifactInput,
    CreateMediaDocumentInput,
    CreateStagedMediaInput,
    Document,
    DocumentSlice,
    StagedMedia,
    StagedMediaActionInput,
    UpdateArtifactInput,
)
from application.conversation_cleanup import (
    ConversationDeletedError,
    assert_conversation_accepts_artifacts,
)
from application.documents import document_to_schema
from application.image_variant import get_or_build_vision_variant
from application.object_store import ObjectStore
from bootstrap.config import get_settings
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from infrastructure.persistence.database import write_tx
from infrastructure.persistence.repositories import documents as document_crud
from infrastructure.persistence.repositories import staged_media as staged_media_crud
from kernel.errors import ConflictError, NotFoundError, RequestError
from sqlalchemy.exc import IntegrityError

from api.http.dependencies import DbSession, require_internal_token

router = APIRouter(
    prefix="/internal",
    tags=["internal"],
    dependencies=[Depends(require_internal_token)],
)


def staged_media_to_schema(row: object) -> StagedMedia:
    return StagedMedia(
        id=row.id,  # type: ignore[attr-defined]
        user_id=row.user_id,  # type: ignore[attr-defined]
        org_id=row.org_id,  # type: ignore[attr-defined]
        conversation_id=row.conversation_id,  # type: ignore[attr-defined]
        title=row.title,  # type: ignore[attr-defined]
        filename=row.filename,  # type: ignore[attr-defined]
        mime_type=row.mime_type,  # type: ignore[attr-defined]
        size=row.size,  # type: ignore[attr-defined]
        object_sha256=row.object_sha256,  # type: ignore[attr-defined]
        status=row.status,  # type: ignore[attr-defined]
        document_id=row.document_id,  # type: ignore[attr-defined]
        created_at=row.created_at.isoformat(),  # type: ignore[attr-defined]
        updated_at=row.updated_at.isoformat(),  # type: ignore[attr-defined]
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


_SLICE_WAIT_MAX_MS = 120_000
_SLICE_POLL_INTERVAL_S = 0.5


def _ready_slice(row: object, start: int, max_chars: int) -> DocumentSlice:
    content = row.content_md  # type: ignore[attr-defined]
    chunk = content[start : start + max_chars]
    next_start = start + len(chunk) if start + len(chunk) < len(content) else None
    return DocumentSlice(
        id=row.id,  # type: ignore[attr-defined]
        title=row.title,  # type: ignore[attr-defined]
        filename=row.filename,  # type: ignore[attr-defined]
        mime_type=row.mime_type,  # type: ignore[attr-defined]
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
        # Still pending/storing/received/converting: wait for the background
        # convert if the caller allowed it, else report "processing" so the model
        # can tell the user the file is not readable yet.
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
        await session.rollback()  # end the read tx so the next poll sees fresh commits
        await asyncio.sleep(_SLICE_POLL_INTERVAL_S)


@router.get("/documents/{document_id}/source")
async def get_document_source(
    document_id: str,
    session: DbSession,
    user_id: str = Query(...),
    max_dim: int | None = Query(default=None, ge=1, le=4096),
) -> Response:
    row = await document_crud.get_document(session, document_id, user_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    if not row.object_bucket or not row.object_key:
        raise NotFoundError("document has no stored source object")
    is_image = (row.source_mime_type or "").lower().startswith("image/")
    if max_dim is not None and not is_image:
        raise RequestError("max_dim is only supported for image sources")
    if max_dim is not None and is_image and not row.object_sha256:
        raise RequestError("image source has no content hash for variant caching")
    if max_dim is not None and is_image and row.object_sha256:
        object_sha256 = row.object_sha256
        object_bucket = row.object_bucket
        object_key = row.object_key
        variant = await anyio.to_thread.run_sync(
            partial(
                get_or_build_vision_variant,
                object_sha256=object_sha256,
                object_bucket=object_bucket,
                object_key=object_key,
                max_dim=max_dim,
            )
        )
        return Response(content=variant, media_type="image/jpeg")
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
            f"{payload.org_id}:{payload.user_id}:{payload.conversation_id or ''}:{payload.idempotency_key}".encode()
        ).hexdigest()[:16]
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
                org_id=payload.org_id,
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
    except IntegrityError:
        # Lost an idempotency-key race: the begin block already rolled back, so
        # re-read the winner's row on a fresh transaction.
        if document_id is None:
            raise
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
            f"{payload.org_id}:{payload.user_id}:{payload.conversation_id or ''}:{payload.idempotency_key}".encode()
        ).hexdigest()[:16]
        # Cheap pre-check in its own short transaction so a retried generation
        # skips re-uploading bytes; the authoritative race guard is below.
        async with write_tx(session):
            await assert_conversation_accepts_artifacts(
                session, user_id=payload.user_id, conversation_id=payload.conversation_id
            )
            existing = await document_crud.get_document(session, document_id, payload.user_id)
        if existing is not None:
            return document_to_schema(existing, include_content=True)
    try:
        raw = base64.b64decode(payload.data_base64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise RequestError("invalid base64 media payload") from exc
    if not raw:
        raise RequestError("empty media payload")
    storage_document_id = document_id or document_crud.new_document_id()
    stored = ObjectStore().put_bytes(
        content=raw,
        filename=payload.filename,
        mime_type=payload.mime_type,
        user_id=payload.user_id,
        prefix=f"media/{payload.conversation_id or 'general'}",
        unique_segment=storage_document_id,
        max_bytes=get_settings().media_max_object_bytes,
    )
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
                org_id=payload.org_id,
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
                document_id=document_id or storage_document_id,
            )
    except ConversationDeletedError:
        ObjectStore().delete(bucket=stored.bucket, key=stored.key)
        raise
    except IntegrityError:
        # Lost an idempotency-key race: the begin block already rolled back, so
        # re-read the winner's row on a fresh transaction. The blob just uploaded
        # is a best-effort orphan.
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
            existing = await staged_media_crud.get_by_idempotency_key(session, payload.idempotency_key, payload.user_id)
        if existing is not None:
            return staged_media_to_schema(existing)
    try:
        raw = base64.b64decode(payload.data_base64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise RequestError("invalid base64 media payload") from exc
    if not raw:
        raise RequestError("empty media payload")
    staged_id = document_crud.new_document_id()
    stored = ObjectStore().put_bytes(
        content=raw,
        filename=payload.filename,
        mime_type=payload.mime_type,
        user_id=payload.user_id,
        prefix=f"staged-media/{payload.conversation_id or 'general'}",
        unique_segment=staged_id,
        max_bytes=get_settings().media_max_object_bytes,
    )
    try:
        async with write_tx(session):
            await assert_conversation_accepts_artifacts(
                session, user_id=payload.user_id, conversation_id=payload.conversation_id
            )
            if payload.idempotency_key:
                existing = await staged_media_crud.get_by_idempotency_key(
                    session, payload.idempotency_key, payload.user_id
                )
                if existing is not None:
                    return staged_media_to_schema(existing)
            row = await staged_media_crud.create_staged_media(
                session,
                staged_id=staged_id,
                user_id=payload.user_id,
                org_id=payload.org_id,
                conversation_id=payload.conversation_id,
                title=payload.title,
                filename=payload.filename,
                mime_type=payload.mime_type,
                size=stored.size,
                object_bucket=stored.bucket,
                object_key=stored.key,
                object_sha256=stored.sha256,
                idempotency_key=payload.idempotency_key,
            )
    except ConversationDeletedError:
        ObjectStore().delete(bucket=stored.bucket, key=stored.key)
        raise
    except IntegrityError:
        if not payload.idempotency_key:
            raise
        existing = await staged_media_crud.get_by_idempotency_key(session, payload.idempotency_key, payload.user_id)
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


@router.get("/staged-media/{staged_id}/source")
async def get_staged_media_source(staged_id: str, session: DbSession, user_id: str = Query(...)) -> Response:
    row = await staged_media_crud.get_staged_media(session, staged_id, user_id)
    if row is None or row.status == "discarded":
        raise NotFoundError(f"staged media {staged_id} not found")
    content = ObjectStore().get_bytes(bucket=row.object_bucket, key=row.object_key)
    return Response(content=content, media_type=row.mime_type)


@router.post("/staged-media/{staged_id}/publish", response_model=Document)
async def publish_staged_media(staged_id: str, payload: StagedMediaActionInput, session: DbSession) -> Document:
    async with write_tx(session):
        row = await staged_media_crud.get_staged_media(session, staged_id, payload.user_id)
        if row is None or row.org_id != payload.org_id or row.status == "discarded":
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
            org_id=row.org_id,
            conversation_id=row.conversation_id,
            kind="artifact",
            title=row.title,
            filename=row.filename,
            mime_type=row.mime_type,
            source_size=row.size,
            source_mime_type=row.mime_type,
            object_bucket=row.object_bucket,
            object_key=row.object_key,
            object_sha256=row.object_sha256,
            ingest_status="ready",
            ingest_progress=100,
        )
        row.status = "published"
        row.document_id = document.id
        row.updated_at = datetime.now(row.updated_at.tzinfo)
        await session.flush()
    return document_to_schema(document, include_content=True)


@router.post("/staged-media/{staged_id}/discard", response_model=StagedMedia)
async def discard_staged_media(staged_id: str, payload: StagedMediaActionInput, session: DbSession) -> StagedMedia:
    object_location: tuple[str, str] | None = None
    async with write_tx(session):
        row = await staged_media_crud.get_staged_media(session, staged_id, payload.user_id)
        if row is None or row.org_id != payload.org_id:
            raise NotFoundError(f"staged media {staged_id} not found")
        if row.status == "published":
            raise ConflictError("published staged media cannot be discarded")
        if row.status != "discarded":
            row.status = "discarded"
            row.updated_at = datetime.now(row.updated_at.tzinfo)
            object_location = (row.object_bucket, row.object_key)
            await session.flush()
    if object_location:
        ObjectStore().delete(bucket=object_location[0], key=object_location[1])
    return staged_media_to_schema(row)


@router.patch("/documents/{document_id}", response_model=Document)
async def update_artifact(
    document_id: str,
    payload: UpdateArtifactInput,
    session: DbSession,
) -> Document:
    async with write_tx(session):
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
    return document_to_schema(row, include_content=True)


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(
    document_id: str,
    session: DbSession,
    user_id: str = Query(...),
) -> None:
    async with write_tx(session):
        row = await document_crud.get_document(session, document_id, user_id)
        if row is None:
            raise NotFoundError(f"document {document_id} not found")
        object_ref = (row.object_bucket, row.object_key) if row.object_bucket and row.object_key else None
        await document_crud.delete_document(session, row)
    if object_ref is not None:
        ObjectStore().delete(bucket=object_ref[0], key=object_ref[1])
