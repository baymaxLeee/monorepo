from datetime import UTC, datetime
from uuid import uuid4

from infrastructure.persistence.database import write_tx
from infrastructure.persistence.models.artifact import (
    ArtifactGenerationBlockRow,
    ArtifactGenerationRow,
    ArtifactRevisionBlockRow,
    ArtifactRevisionRow,
)
from infrastructure.persistence.models.document import DocumentRow
from infrastructure.persistence.repositories import documents as document_crud
from kernel.errors import ConflictError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from application.artifact_generation_state import assert_generation_writable, get_owned_generation
from application.contracts.artifact import PublishArtifactRevisionInput, PublishedArtifactRevision
from application.conversation_cleanup import assert_conversation_accepts_artifacts
from application.object_store import ObjectStore


def _id() -> str:
    return uuid4().hex[:26]


async def _completed_revision(
    session: AsyncSession, generation: ArtifactGenerationRow
) -> PublishedArtifactRevision | None:
    if generation.status != "completed":
        return None
    revision = await session.scalar(
        select(ArtifactRevisionRow).where(ArtifactRevisionRow.generation_id == generation.id)
    )
    document = await document_crud.get_document(session, generation.document_id, generation.user_id)
    if revision is None or document is None:
        raise ConflictError("completed artifact revision is incomplete")
    return PublishedArtifactRevision(
        document_id=generation.document_id,
        revision_id=revision.id,
        title=generation.title,
        filename=generation.filename,
        total_chars=document.source_size,
    )


async def publish_artifact_revision(
    session: AsyncSession,
    generation_id: str,
    payload: PublishArtifactRevisionInput,
) -> PublishedArtifactRevision:
    old_object: tuple[str, str] | None = None
    async with write_tx(session):
        generation = await get_owned_generation(session, generation_id, payload.user_id, for_update=True)
        completed = await _completed_revision(session, generation)
        if completed:
            return completed
        assert_generation_writable(generation)
        await assert_conversation_accepts_artifacts(
            session, user_id=payload.user_id, conversation_id=generation.conversation_id
        )
        ready_count = int(
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
        if ready_count != generation.total_blocks:
            raise ConflictError("artifact blocks are not complete")

        document = await session.scalar(
            select(DocumentRow)
            .where(DocumentRow.id == generation.document_id, DocumentRow.user_id == payload.user_id)
            .with_for_update()
        )
        if document is not None:
            if generation.base_revision_id != document.current_revision_id:
                raise ConflictError("artifact base revision is stale")
            if (
                payload.expected_object_sha256
                and document.object_sha256
                and document.object_sha256 != payload.expected_object_sha256
            ):
                raise ConflictError("artifact document was modified concurrently")
            if document.object_bucket and document.object_key:
                old_object = (document.object_bucket, document.object_key)
        elif generation.base_revision_id:
            raise ConflictError("artifact base revision no longer exists")

        stored = ObjectStore().put_bytes(
            content=payload.compiled_html.encode(),
            filename="current.html",
            mime_type="text/html",
            user_id=payload.user_id,
            prefix=f"artifacts/{generation.document_id}",
        )
        now = datetime.now(UTC)
        revision_id = _id()
        session.add(
            ArtifactRevisionRow(
                id=revision_id,
                document_id=generation.document_id,
                parent_revision_id=generation.base_revision_id,
                generation_id=generation.id,
                manifest_json=generation.manifest_json or {},
                created_at=now,
            )
        )
        generation_blocks = (
            await session.scalars(
                select(ArtifactGenerationBlockRow)
                .where(ArtifactGenerationBlockRow.generation_id == generation.id)
                .order_by(ArtifactGenerationBlockRow.position)
            )
        ).all()
        if len(generation_blocks) != generation.total_blocks or any(
            block.version_id is None for block in generation_blocks
        ):
            raise ConflictError("artifact block snapshot is incomplete")
        for block in generation_blocks:
            if block.version_id is None:
                raise ConflictError("artifact block snapshot is incomplete")
            session.add(
                ArtifactRevisionBlockRow(
                    revision_id=revision_id,
                    block_id=block.block_id,
                    version_id=block.version_id,
                    position=block.position,
                )
            )
        values = {
            "title": generation.title,
            "filename": generation.filename,
            "mime_type": "text/html",
            "content_md": "",
            "source_size": stored.size,
            "source_mime_type": "text/html",
            "object_bucket": stored.bucket,
            "object_key": stored.key,
            "object_sha256": stored.sha256,
            "current_revision_id": revision_id,
        }
        if document is None:
            org_id = payload.org_id
            if isinstance(generation.manifest_json, dict):
                org_id = str(generation.manifest_json.get("org_id") or org_id)
            await document_crud.create_document(
                session,
                user_id=payload.user_id,
                org_id=org_id,
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
                current_revision_id=revision_id,
                ingest_status="ready",
                ingest_progress=100,
                document_id=generation.document_id,
            )
        else:
            await document_crud.update_document(session, document, values)
        generation.status = "completed"
        generation.finished_at = now
        generation.updated_at = now
        await session.flush()

    if old_object and old_object != (stored.bucket, stored.key):
        ObjectStore().delete(bucket=old_object[0], key=old_object[1])
    return PublishedArtifactRevision(
        document_id=generation.document_id,
        revision_id=revision_id,
        title=generation.title,
        filename=generation.filename,
        total_chars=stored.size,
    )
