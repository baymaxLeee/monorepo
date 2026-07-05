"""Storage API for chat's durable artifact workflow.

The executor's Workflow DevKit run is the sole owner of a generation from
reserve to publish — there is no worker pool or lease protocol. A generation
is purely the durable background-task record (progress + idempotency) that the
executor task's cancel handler can flip to `cancelled`; the served artifact is
documents.object_key, overwritten in place at publish, and the "current" block
set is the latest completed generation's blocks.
"""

from datetime import UTC, datetime
from hashlib import sha256
from typing import cast
from uuid import uuid4

from fastapi import APIRouter, Depends
from kernel.errors import ConflictError, NotFoundError
from knowledge.crud import documents as document_crud
from knowledge.deps import DbSession, require_internal_token
from knowledge.models.artifact import ArtifactBlockVersionRow, ArtifactGenerationRow
from knowledge.models.document import DocumentRow
from knowledge.schemas.artifact import (
    ArtifactGeneration,
    ArtifactRevisionWorkspace,
    CancelArtifactGenerationInput,
    FailArtifactGenerationInput,
    PublishArtifactRevisionInput,
    PublishedArtifactRevision,
    ReserveArtifactGenerationInput,
    SaveArtifactBlockInput,
    SaveArtifactPlanInput,
    StoredArtifactBlock,
)
from knowledge.services.object_store import ObjectStore
from sqlalchemy import func, select

router = APIRouter(
    prefix="/internal/artifact-generations",
    tags=["artifact-generations"],
    dependencies=[Depends(require_internal_token)],
)


def _id() -> str:
    return uuid4().hex[:26]


def _generation_schema(row: ArtifactGenerationRow) -> ArtifactGeneration:
    return ArtifactGeneration(
        id=row.id,
        document_id=row.document_id,
        status=row.status,
        total_blocks=row.total_blocks,
        completed_blocks=row.completed_blocks,
        failed_blocks=row.failed_blocks,
        error=row.error,
        finished_at=row.finished_at.isoformat() if row.finished_at else None,
    )


async def _owned_generation(session: DbSession, generation_id: str, user_id: str) -> ArtifactGenerationRow:
    row = await session.scalar(
        select(ArtifactGenerationRow).where(
            ArtifactGenerationRow.id == generation_id,
            ArtifactGenerationRow.user_id == user_id,
        )
    )
    if row is None:
        raise NotFoundError(f"artifact generation {generation_id} not found")
    return row


async def _head_generation(session: DbSession, document_id: str, user_id: str) -> ArtifactGenerationRow | None:
    """The document's current state = its most recent completed generation."""
    return cast(
        "ArtifactGenerationRow | None",
        await session.scalar(
            select(ArtifactGenerationRow)
            .where(
                ArtifactGenerationRow.document_id == document_id,
                ArtifactGenerationRow.user_id == user_id,
                ArtifactGenerationRow.status == "completed",
            )
            .order_by(ArtifactGenerationRow.finished_at.desc())
        ),
    )


@router.post("", response_model=ArtifactGeneration, status_code=201)
async def reserve_generation(payload: ReserveArtifactGenerationInput, session: DbSession) -> ArtifactGeneration:
    existing = await session.scalar(
        select(ArtifactGenerationRow).where(ArtifactGenerationRow.idempotency_key == payload.idempotency_key)
    )
    if existing is not None:
        if existing.user_id != payload.user_id:
            raise ConflictError("artifact idempotency key belongs to another user")
        return _generation_schema(existing)

    document_id = sha256(f"{payload.user_id}:{payload.idempotency_key}".encode()).hexdigest()[:16]
    if payload.document_id:
        document = await document_crud.get_document(session, payload.document_id, payload.user_id)
        if document is None or document.kind != "artifact":
            raise NotFoundError(f"artifact document {payload.document_id} not found")
        document_id = payload.document_id

    now = datetime.now(UTC)
    row = ArtifactGenerationRow(
        id=_id(),
        document_id=document_id,
        user_id=payload.user_id,
        conversation_id=payload.conversation_id,
        title=payload.title,
        filename=payload.filename,
        brief=payload.brief,
        idempotency_key=payload.idempotency_key,
        status="queued",
        manifest_json={"schemaVersion": 1, "mode": payload.mode, "blocks": []},
        total_blocks=0,
        completed_blocks=0,
        failed_blocks=0,
        error=None,
        created_at=now,
        updated_at=now,
        finished_at=None,
    )
    session.add(row)
    await session.commit()
    return _generation_schema(row)


@router.post("/{generation_id}/fail", response_model=ArtifactGeneration)
async def fail_generation(
    generation_id: str, payload: FailArtifactGenerationInput, session: DbSession
) -> ArtifactGeneration:
    row = await _owned_generation(session, generation_id, payload.user_id)
    now = datetime.now(UTC)
    row.status = "failed"
    row.error = payload.error
    row.finished_at = now
    row.updated_at = now
    await session.commit()
    return _generation_schema(row)


@router.post("/{generation_id}/cancel", response_model=ArtifactGeneration)
async def cancel_generation(
    generation_id: str, payload: CancelArtifactGenerationInput, session: DbSession
) -> ArtifactGeneration:
    row = await _owned_generation(session, generation_id, payload.user_id)
    if row.status in {"completed", "failed", "cancelled"}:
        return _generation_schema(row)
    now = datetime.now(UTC)
    row.status = "cancelled"
    row.cancel_requested_at = now
    row.finished_at = now
    row.updated_at = now
    await session.commit()
    return _generation_schema(row)


@router.put("/{generation_id}/plan", response_model=ArtifactGeneration)
async def save_plan(generation_id: str, payload: SaveArtifactPlanInput, session: DbSession) -> ArtifactGeneration:
    row = await _owned_generation(session, generation_id, payload.user_id)
    now = datetime.now(UTC)
    row.manifest_json = payload.manifest
    row.total_blocks = len(payload.blocks)
    if row.status == "queued":
        row.status = "running"
    row.updated_at = now
    existing_ids = set(
        (
            await session.scalars(
                select(ArtifactBlockVersionRow.block_id).where(ArtifactBlockVersionRow.generation_id == generation_id)
            )
        ).all()
    )
    missing = [(position, block) for position, block in enumerate(payload.blocks) if block.id not in existing_ids]
    if missing:
        session.add_all(
            ArtifactBlockVersionRow(
                id=_id(),
                generation_id=row.id,
                block_id=block.id,
                block_type=block.type,
                position=position,
                status="planned",
                object_bucket=None,
                object_key=None,
                object_sha256=None,
                error=None,
                created_at=now,
                updated_at=now,
            )
            for position, block in missing
        )
    await session.commit()
    return _generation_schema(row)


@router.put("/{generation_id}/blocks/{block_id}", response_model=ArtifactGeneration)
async def save_block(
    generation_id: str, block_id: str, payload: SaveArtifactBlockInput, session: DbSession
) -> ArtifactGeneration:
    generation = await _owned_generation(session, generation_id, payload.user_id)
    if generation.status == "cancelled":
        raise ConflictError("artifact generation was cancelled")
    block = await session.scalar(
        select(ArtifactBlockVersionRow).where(
            ArtifactBlockVersionRow.generation_id == generation_id,
            ArtifactBlockVersionRow.block_id == block_id,
        )
    )
    if block is None:
        raise NotFoundError(f"artifact block {block_id} not found")
    if block.status == "ready":
        return _generation_schema(generation)
    stored = ObjectStore().put_bytes(
        content=payload.content.encode(),
        filename=f"{block_id}.json",
        mime_type="application/json",
        user_id=payload.user_id,
        prefix=f"artifacts/{generation.document_id}/blocks/{generation.id}",
    )
    block.status = "ready"
    block.object_bucket = stored.bucket
    block.object_key = stored.key
    block.object_sha256 = stored.sha256
    block.error = "block generation failed" if payload.failed else None
    block.updated_at = datetime.now(UTC)
    await session.flush()
    generation.completed_blocks = int(
        await session.scalar(
            select(func.count())
            .select_from(ArtifactBlockVersionRow)
            .where(
                ArtifactBlockVersionRow.generation_id == generation_id,
                ArtifactBlockVersionRow.status == "ready",
            )
        )
        or 0
    )
    generation.failed_blocks = int(
        await session.scalar(
            select(func.count())
            .select_from(ArtifactBlockVersionRow)
            .where(
                ArtifactBlockVersionRow.generation_id == generation_id,
                ArtifactBlockVersionRow.error.is_not(None),
            )
        )
        or 0
    )
    generation.updated_at = datetime.now(UTC)
    await session.commit()
    return _generation_schema(generation)


@router.get("/{generation_id}/blocks", response_model=list[StoredArtifactBlock])
async def list_ready_blocks(generation_id: str, user_id: str, session: DbSession) -> list[StoredArtifactBlock]:
    await _owned_generation(session, generation_id, user_id)
    rows = (
        await session.scalars(
            select(ArtifactBlockVersionRow)
            .where(
                ArtifactBlockVersionRow.generation_id == generation_id,
                ArtifactBlockVersionRow.status == "ready",
            )
            .order_by(ArtifactBlockVersionRow.position)
        )
    ).all()
    store = ObjectStore()
    return [
        StoredArtifactBlock(
            id=row.block_id,
            type=row.block_type,
            position=row.position,
            content=store.get_bytes(bucket=row.object_bucket, key=row.object_key).decode(),
        )
        for row in rows
        if row.object_bucket and row.object_key
    ]


@router.get("/documents/{document_id}/latest", response_model=ArtifactRevisionWorkspace)
async def get_latest_workspace(document_id: str, user_id: str, session: DbSession) -> ArtifactRevisionWorkspace:
    document = await document_crud.get_document(session, document_id, user_id)
    if document is None or document.kind != "artifact":
        raise NotFoundError(f"artifact document {document_id} not found")
    head = await _head_generation(session, document_id, user_id)
    if head is None:
        raise NotFoundError(f"artifact workspace for document {document_id} not found")
    blocks = await list_ready_blocks(head.id, user_id, session)
    return ArtifactRevisionWorkspace(
        document_id=document_id,
        manifest=head.manifest_json or {},
        blocks=blocks,
    )


@router.post("/{generation_id}/publish", response_model=PublishedArtifactRevision)
async def publish_revision(
    generation_id: str, payload: PublishArtifactRevisionInput, session: DbSession
) -> PublishedArtifactRevision:
    generation = await _owned_generation(session, generation_id, payload.user_id)
    if generation.status == "cancelled":
        raise ConflictError("artifact generation was cancelled")
    if generation.status == "completed":
        # Idempotent: the durable publish step already ran (WDK may retry it).
        published_doc = await document_crud.get_document(session, generation.document_id, payload.user_id)
        return PublishedArtifactRevision(
            document_id=generation.document_id,
            title=generation.title,
            filename=generation.filename,
            total_chars=published_doc.source_size if published_doc else 0,
        )
    if generation.completed_blocks != generation.total_blocks:
        raise ConflictError("artifact blocks are not complete")
    # Lock the document row so concurrent edits to the same artifact serialize and
    # the in-place HTML overwrite stays consistent (last writer wins).
    document = await session.scalar(
        select(DocumentRow)
        .where(DocumentRow.id == generation.document_id, DocumentRow.user_id == payload.user_id)
        .with_for_update()
    )
    stored = ObjectStore().put_bytes(
        content=payload.compiled_html.encode(),
        filename=generation.filename,
        mime_type="text/html",
        user_id=payload.user_id,
        prefix=f"artifacts/{generation.document_id}",
    )
    now = datetime.now(UTC)
    if document is None:
        await document_crud.create_document(
            session,
            user_id=payload.user_id,
            conversation_id=generation.conversation_id,
            kind="artifact",
            title=generation.title,
            filename=generation.filename,
            mime_type="text/html",
            content_md="",
            source_size=stored.size,
            source_mime_type="text/html",
            object_bucket=stored.bucket,
            object_key=stored.key,
            object_sha256=stored.sha256,
            ingest_status="ready",
            ingest_progress=100,
            document_id=generation.document_id,
        )
    else:
        await document_crud.update_document(
            session,
            document,
            {
                "title": generation.title,
                "filename": generation.filename,
                "mime_type": "text/html",
                "content_md": "",
                "source_size": stored.size,
                "source_mime_type": "text/html",
                "object_bucket": stored.bucket,
                "object_key": stored.key,
                "object_sha256": stored.sha256,
            },
        )
    generation.updated_at = now
    await session.flush()
    generation.status = "completed"
    generation.finished_at = now
    generation.updated_at = now
    await session.commit()
    return PublishedArtifactRevision(
        document_id=generation.document_id,
        title=generation.title,
        filename=generation.filename,
        total_chars=stored.size,
    )
