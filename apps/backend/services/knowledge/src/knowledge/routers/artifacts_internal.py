"""Storage API for chat-owned durable Artifact tools."""

from datetime import UTC, datetime
from hashlib import sha256
from uuid import uuid4

from fastapi import APIRouter, Depends
from kernel.errors import ConflictError, NotFoundError
from knowledge.crud import documents as document_crud
from knowledge.deps import DbSession, require_internal_token
from knowledge.models.artifact import ArtifactBlockVersionRow, ArtifactGenerationRow, ArtifactRevisionRow
from knowledge.schemas.artifact import (
    ArtifactGeneration,
    ArtifactRevisionWorkspace,
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
        phase=row.phase,
        total_blocks=row.total_blocks,
        completed_blocks=row.completed_blocks,
        failed_blocks=row.failed_blocks,
        error=row.error,
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
    base_revision_id = payload.base_revision_id
    if payload.document_id:
        document = await document_crud.get_document(session, payload.document_id, payload.user_id)
        if document is None or document.kind != "artifact":
            raise NotFoundError(f"artifact document {payload.document_id} not found")
        latest_revision = await session.scalar(
            select(ArtifactRevisionRow)
            .where(ArtifactRevisionRow.document_id == payload.document_id)
            .order_by(ArtifactRevisionRow.created_at.desc())
        )
        if latest_revision is None:
            raise NotFoundError(f"artifact revision for document {payload.document_id} not found")
        document_id = payload.document_id
        base_revision_id = latest_revision.id

    now = datetime.now(UTC)
    row = ArtifactGenerationRow(
        id=_id(),
        document_id=document_id,
        user_id=payload.user_id,
        conversation_id=payload.conversation_id,
        kind="update" if payload.document_id or payload.base_revision_id else "create",
        title=payload.title,
        filename=payload.filename,
        brief=payload.brief,
        idempotency_key=payload.idempotency_key,
        base_revision_id=base_revision_id,
        status="queued",
        phase="reserved",
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


@router.get("/{generation_id}", response_model=ArtifactGeneration)
async def get_generation(generation_id: str, user_id: str, session: DbSession) -> ArtifactGeneration:
    return _generation_schema(await _owned_generation(session, generation_id, user_id))


@router.put("/{generation_id}/plan", response_model=ArtifactGeneration)
async def save_plan(generation_id: str, payload: SaveArtifactPlanInput, session: DbSession) -> ArtifactGeneration:
    row = await _owned_generation(session, generation_id, payload.user_id)
    now = datetime.now(UTC)
    row.manifest_json = payload.manifest
    row.total_blocks = len(payload.blocks)
    row.phase = "generating_blocks"
    row.updated_at = now
    existing = await session.scalar(
        select(func.count()).select_from(ArtifactBlockVersionRow).where(
            ArtifactBlockVersionRow.generation_id == generation_id
        )
    )
    if not existing:
        session.add_all(
            ArtifactBlockVersionRow(
                id=_id(),
                document_id=row.document_id,
                generation_id=row.id,
                block_id=block.id,
                block_type=block.type,
                position=position,
                brief=block.brief,
                status="planned",
                object_bucket=None,
                object_key=None,
                object_sha256=None,
                content_size=0,
                error=None,
                created_at=now,
                updated_at=now,
            )
            for position, block in enumerate(payload.blocks)
        )
    await session.commit()
    return _generation_schema(row)


@router.put("/{generation_id}/blocks/{block_id}", response_model=ArtifactGeneration)
async def save_block(
    generation_id: str, block_id: str, payload: SaveArtifactBlockInput, session: DbSession
) -> ArtifactGeneration:
    generation = await _owned_generation(session, generation_id, payload.user_id)
    block = await session.scalar(
        select(ArtifactBlockVersionRow).where(
            ArtifactBlockVersionRow.generation_id == generation_id,
            ArtifactBlockVersionRow.block_id == block_id,
        )
    )
    if block is None:
        raise NotFoundError(f"artifact block {block_id} not found")
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
    block.content_size = stored.size
    block.updated_at = datetime.now(UTC)
    await session.flush()
    generation.completed_blocks = int(
        await session.scalar(
            select(func.count()).select_from(ArtifactBlockVersionRow).where(
                ArtifactBlockVersionRow.generation_id == generation_id,
                ArtifactBlockVersionRow.status == "ready",
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
async def get_latest_workspace(
    document_id: str, user_id: str, session: DbSession
) -> ArtifactRevisionWorkspace:
    document = await document_crud.get_document(session, document_id, user_id)
    if document is None or document.kind != "artifact":
        raise NotFoundError(f"artifact document {document_id} not found")
    revision = await session.scalar(
        select(ArtifactRevisionRow)
        .where(ArtifactRevisionRow.document_id == document_id)
        .order_by(ArtifactRevisionRow.created_at.desc())
    )
    if revision is None:
        raise NotFoundError(f"artifact revision for document {document_id} not found")
    blocks = await list_ready_blocks(revision.generation_id, user_id, session)
    return ArtifactRevisionWorkspace(
        document_id=document_id,
        revision_id=revision.id,
        manifest=revision.manifest_json,
        blocks=blocks,
    )


@router.post("/{generation_id}/publish", response_model=PublishedArtifactRevision)
async def publish_revision(
    generation_id: str, payload: PublishArtifactRevisionInput, session: DbSession
) -> PublishedArtifactRevision:
    generation = await _owned_generation(session, generation_id, payload.user_id)
    existing_revision = await session.scalar(
        select(ArtifactRevisionRow).where(ArtifactRevisionRow.generation_id == generation_id)
    )
    if existing_revision is not None:
        return PublishedArtifactRevision(
            document_id=generation.document_id,
            revision_id=existing_revision.id,
            title=generation.title,
            filename=generation.filename,
            total_chars=existing_revision.content_size,
        )
    if generation.completed_blocks != generation.total_blocks:
        raise ConflictError("artifact blocks are not complete")
    stored = ObjectStore().put_bytes(
        content=payload.compiled_html.encode(),
        filename=generation.filename,
        mime_type="text/html",
        user_id=payload.user_id,
        prefix=f"artifacts/{generation.document_id}/revisions",
    )
    now = datetime.now(UTC)
    revision = ArtifactRevisionRow(
        id=_id(),
        document_id=generation.document_id,
        parent_revision_id=generation.base_revision_id,
        generation_id=generation.id,
        manifest_json=generation.manifest_json or {},
        object_bucket=stored.bucket,
        object_key=stored.key,
        object_sha256=stored.sha256,
        content_size=stored.size,
        created_at=now,
    )
    session.add(revision)
    document = await document_crud.get_document(session, generation.document_id, payload.user_id)
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
    generation.status = "completed"
    generation.phase = "published"
    generation.finished_at = now
    generation.updated_at = now
    await session.commit()
    return PublishedArtifactRevision(
        document_id=generation.document_id,
        revision_id=revision.id,
        title=generation.title,
        filename=generation.filename,
        total_chars=len(payload.compiled_html),
    )
