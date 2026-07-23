"""Content-addressed storage API for Executor's durable artifact workflow."""

from datetime import UTC, datetime
from hashlib import sha256
from uuid import uuid4

from application.artifact_generation_state import assert_generation_writable, get_owned_generation
from application.artifact_publish import publish_artifact_revision
from application.contracts.artifact import (
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
from application.conversation_cleanup import assert_conversation_accepts_artifacts
from application.object_store import ObjectStore
from fastapi import APIRouter, Depends
from infrastructure.persistence.database import write_tx
from infrastructure.persistence.models.artifact import (
    ArtifactBlockVersionRow,
    ArtifactGenerationBlockRow,
    ArtifactGenerationRow,
    ArtifactRevisionBlockRow,
    ArtifactRevisionRow,
)
from infrastructure.persistence.repositories import documents as document_crud
from kernel.errors import ConflictError, NotFoundError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from api.http.dependencies import DbSession, require_internal_token

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


async def _refresh_counts(session: DbSession, generation: ArtifactGenerationRow) -> None:
    generation.completed_blocks = int(
        await session.scalar(
            select(func.count())
            .select_from(ArtifactGenerationBlockRow)
            .where(
                ArtifactGenerationBlockRow.generation_id == generation.id,
                ArtifactGenerationBlockRow.status == "ready",
                ArtifactGenerationBlockRow.version_id.is_not(None),
            )
        )
        or 0
    )
    generation.failed_blocks = int(
        await session.scalar(
            select(func.count())
            .select_from(ArtifactGenerationBlockRow)
            .where(
                ArtifactGenerationBlockRow.generation_id == generation.id,
                ArtifactGenerationBlockRow.error.is_not(None),
            )
        )
        or 0
    )


async def _stored_blocks_for_generation(session: DbSession, generation_id: str) -> list[StoredArtifactBlock]:
    rows = (
        await session.execute(
            select(ArtifactGenerationBlockRow, ArtifactBlockVersionRow)
            .join(
                ArtifactBlockVersionRow,
                ArtifactBlockVersionRow.id == ArtifactGenerationBlockRow.version_id,
            )
            .where(
                ArtifactGenerationBlockRow.generation_id == generation_id,
                ArtifactGenerationBlockRow.status == "ready",
            )
            .order_by(ArtifactGenerationBlockRow.position)
        )
    ).all()
    store = ObjectStore()
    return [
        StoredArtifactBlock(
            id=block.block_id,
            version_id=version.id,
            type=version.block_type,
            position=block.position,
            content_sha256=version.object_sha256,
            content=store.get_bytes(bucket=version.object_bucket, key=version.object_key).decode(),
        )
        for block, version in rows
    ]


@router.post("", response_model=ArtifactGeneration, status_code=201)
async def reserve_generation(payload: ReserveArtifactGenerationInput, session: DbSession) -> ArtifactGeneration:
    async with write_tx(session):
        await assert_conversation_accepts_artifacts(
            session, user_id=payload.user_id, conversation_id=payload.conversation_id
        )
        existing = await session.scalar(
            select(ArtifactGenerationRow).where(ArtifactGenerationRow.idempotency_key == payload.idempotency_key)
        )
        if existing is not None:
            if existing.user_id != payload.user_id:
                raise ConflictError("artifact idempotency key belongs to another user")
            return _generation_schema(existing)

        document_id = sha256(f"{payload.org_id}:{payload.user_id}:{payload.idempotency_key}".encode()).hexdigest()[:16]
        if payload.document_id:
            document = await document_crud.get_document(session, payload.document_id, payload.user_id)
            if document is None or document.kind != "artifact":
                raise NotFoundError(f"artifact document {payload.document_id} not found")
            if not payload.base_revision_id or payload.base_revision_id != document.current_revision_id:
                raise ConflictError("artifact base revision is stale")
            document_id = payload.document_id
        elif payload.base_revision_id:
            raise ConflictError("a new artifact cannot have a base revision")

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
            base_revision_id=payload.base_revision_id,
            status="queued",
            manifest_json={
                "schemaVersion": 1,
                "mode": payload.mode,
                "blocks": [],
                **({"org_id": payload.org_id} if payload.org_id else {}),
            },
            total_blocks=0,
            completed_blocks=0,
            failed_blocks=0,
            error=None,
            created_at=now,
            updated_at=now,
            finished_at=None,
        )
        session.add(row)
    return _generation_schema(row)


@router.post("/{generation_id}/fail", response_model=ArtifactGeneration)
async def fail_generation(
    generation_id: str, payload: FailArtifactGenerationInput, session: DbSession
) -> ArtifactGeneration:
    async with write_tx(session):
        row = await get_owned_generation(session, generation_id, payload.user_id)
        now = datetime.now(UTC)
        row.status = "failed"
        row.error = payload.error
        row.finished_at = now
        row.updated_at = now
    return _generation_schema(row)


@router.post("/{generation_id}/cancel", response_model=ArtifactGeneration)
async def cancel_generation(
    generation_id: str, payload: CancelArtifactGenerationInput, session: DbSession
) -> ArtifactGeneration:
    async with write_tx(session):
        row = await get_owned_generation(session, generation_id, payload.user_id)
        if row.status in {"completed", "failed", "cancelled"}:
            return _generation_schema(row)
        now = datetime.now(UTC)
        row.status = "cancelled"
        row.cancel_requested_at = now
        row.finished_at = now
        row.updated_at = now
    return _generation_schema(row)


@router.put("/{generation_id}/plan", response_model=ArtifactGeneration)
async def save_plan(generation_id: str, payload: SaveArtifactPlanInput, session: DbSession) -> ArtifactGeneration:
    async with write_tx(session):
        generation = await get_owned_generation(session, generation_id, payload.user_id, for_update=True)
        assert_generation_writable(generation)
        await assert_conversation_accepts_artifacts(
            session, user_id=payload.user_id, conversation_id=generation.conversation_id
        )
        existing_ids = set(
            (
                await session.scalars(
                    select(ArtifactGenerationBlockRow.block_id).where(
                        ArtifactGenerationBlockRow.generation_id == generation_id
                    )
                )
            ).all()
        )
        now = datetime.now(UTC)
        for position, block in enumerate(payload.blocks):
            if block.id in existing_ids:
                continue
            status = "planned"
            if block.source_version_id:
                inherited = await session.scalar(
                    select(ArtifactRevisionBlockRow.version_id).where(
                        ArtifactRevisionBlockRow.revision_id == generation.base_revision_id,
                        ArtifactRevisionBlockRow.block_id == block.id,
                    )
                )
                if inherited != block.source_version_id:
                    raise ConflictError(f"artifact block {block.id} source version is stale")
                status = "ready"
            session.add(
                ArtifactGenerationBlockRow(
                    id=_id(),
                    generation_id=generation.id,
                    block_id=block.id,
                    block_type=block.type,
                    position=position,
                    status=status,
                    version_id=block.source_version_id,
                    error=None,
                    created_at=now,
                    updated_at=now,
                )
            )
        generation.manifest_json = payload.manifest
        generation.total_blocks = len(payload.blocks)
        generation.status = "running"
        generation.updated_at = now
        await session.flush()
        await _refresh_counts(session, generation)
    return _generation_schema(generation)


@router.put("/{generation_id}/blocks/{block_id}", response_model=ArtifactGeneration)
async def save_block(
    generation_id: str, block_id: str, payload: SaveArtifactBlockInput, session: DbSession
) -> ArtifactGeneration:
    async with write_tx(session):
        generation = await get_owned_generation(session, generation_id, payload.user_id)
        assert_generation_writable(generation)
        block = await session.scalar(
            select(ArtifactGenerationBlockRow).where(
                ArtifactGenerationBlockRow.generation_id == generation_id,
                ArtifactGenerationBlockRow.block_id == block_id,
            )
        )
        if block is None:
            raise NotFoundError(f"artifact block {block_id} not found")
        if block.status == "ready":
            return _generation_schema(generation)

    content = payload.content.encode()
    content_sha256 = sha256(content).hexdigest()
    stored = ObjectStore().put_bytes(
        content=content,
        filename=f"{content_sha256}.json",
        mime_type="application/json",
        user_id=payload.user_id,
        prefix=f"artifacts/{generation.document_id}/blocks",
    )
    async with write_tx(session):
        generation = await get_owned_generation(session, generation_id, payload.user_id, for_update=True)
        assert_generation_writable(generation)
        await assert_conversation_accepts_artifacts(
            session, user_id=payload.user_id, conversation_id=generation.conversation_id
        )
        block = await session.scalar(
            select(ArtifactGenerationBlockRow)
            .where(
                ArtifactGenerationBlockRow.generation_id == generation_id,
                ArtifactGenerationBlockRow.block_id == block_id,
            )
            .with_for_update()
        )
        if block is None:
            raise NotFoundError(f"artifact block {block_id} not found")
        if block.status == "ready":
            return _generation_schema(generation)
        version_id = _id()
        await session.execute(
            insert(ArtifactBlockVersionRow)
            .values(
                id=version_id,
                document_id=generation.document_id,
                user_id=payload.user_id,
                block_id=block.block_id,
                block_type=block.block_type,
                object_bucket=stored.bucket,
                object_key=stored.key,
                object_sha256=stored.sha256,
                created_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing(
                index_elements=[
                    ArtifactBlockVersionRow.document_id,
                    ArtifactBlockVersionRow.block_id,
                    ArtifactBlockVersionRow.object_sha256,
                ]
            )
        )
        version = await session.scalar(
            select(ArtifactBlockVersionRow).where(
                ArtifactBlockVersionRow.document_id == generation.document_id,
                ArtifactBlockVersionRow.block_id == block.block_id,
                ArtifactBlockVersionRow.object_sha256 == stored.sha256,
            )
        )
        if version is None:
            raise ConflictError("artifact block version could not be resolved")
        block.status = "ready"
        block.version_id = version.id
        block.error = "block generation failed" if payload.failed else None
        block.updated_at = datetime.now(UTC)
        await session.flush()
        await _refresh_counts(session, generation)
        generation.updated_at = datetime.now(UTC)
    return _generation_schema(generation)


@router.get("/{generation_id}/blocks", response_model=list[StoredArtifactBlock])
async def list_ready_blocks(generation_id: str, user_id: str, session: DbSession) -> list[StoredArtifactBlock]:
    await get_owned_generation(session, generation_id, user_id)
    return await _stored_blocks_for_generation(session, generation_id)


@router.get("/documents/{document_id}/latest", response_model=ArtifactRevisionWorkspace)
async def get_latest_workspace(document_id: str, user_id: str, session: DbSession) -> ArtifactRevisionWorkspace:
    document = await document_crud.get_document(session, document_id, user_id)
    if document is None or document.kind != "artifact":
        raise NotFoundError(f"artifact document {document_id} not found")
    if not document.current_revision_id:
        raise NotFoundError(f"artifact workspace for document {document_id} not found")
    revision = await session.get(ArtifactRevisionRow, document.current_revision_id)
    if revision is None:
        raise NotFoundError(f"artifact revision {document.current_revision_id} not found")
    rows = (
        await session.execute(
            select(ArtifactRevisionBlockRow, ArtifactBlockVersionRow)
            .join(ArtifactBlockVersionRow, ArtifactBlockVersionRow.id == ArtifactRevisionBlockRow.version_id)
            .where(ArtifactRevisionBlockRow.revision_id == revision.id)
            .order_by(ArtifactRevisionBlockRow.position)
        )
    ).all()
    store = ObjectStore()
    blocks = [
        StoredArtifactBlock(
            id=block.block_id,
            version_id=version.id,
            type=version.block_type,
            position=block.position,
            content_sha256=version.object_sha256,
            content=store.get_bytes(bucket=version.object_bucket, key=version.object_key).decode(),
        )
        for block, version in rows
    ]
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
    return await publish_artifact_revision(session, generation_id, payload)
