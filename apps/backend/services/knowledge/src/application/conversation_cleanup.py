from datetime import UTC, datetime
from functools import partial
from hashlib import blake2b

import anyio
from infrastructure.persistence.database import get_session_factory, write_tx
from infrastructure.persistence.models.artifact import ArtifactBlockVersionRow, ArtifactGenerationRow
from infrastructure.persistence.models.conversation_cleanup import ConversationArtifactTombstoneRow
from infrastructure.persistence.models.document import DocumentRow
from infrastructure.persistence.models.staged_media import StagedMediaRow
from kernel.errors import ConflictError
from sqlalchemy import delete, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from application.contracts.conversation_cleanup import (
    CleanupConversationArtifactsInput,
    CleanupConversationArtifactsResult,
)
from application.object_store import ObjectStore


class ConversationDeletedError(ConflictError):
    code = "conversation_deleted"


def _conversation_lock_key(conversation_id: str) -> int:
    digest = blake2b(f"conversation-artifacts:{conversation_id}".encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


async def _lock_conversation_artifacts(session: AsyncSession, conversation_id: str) -> None:
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:key)"),
        {"key": _conversation_lock_key(conversation_id)},
    )


async def assert_conversation_accepts_artifacts(
    session: AsyncSession,
    *,
    user_id: str,
    conversation_id: str | None,
) -> None:
    if conversation_id is None:
        return
    await _lock_conversation_artifacts(session, conversation_id)
    tombstone = await session.scalar(
        select(ConversationArtifactTombstoneRow.conversation_id).where(
            ConversationArtifactTombstoneRow.conversation_id == conversation_id,
            ConversationArtifactTombstoneRow.user_id == user_id,
        )
    )
    if tombstone is not None:
        raise ConversationDeletedError("conversation was deleted; generated artifacts are no longer accepted")


async def cleanup_conversation_artifacts(
    payload: CleanupConversationArtifactsInput,
) -> CleanupConversationArtifactsResult:
    factory = get_session_factory()
    async with factory() as session, write_tx(session):
        await _lock_conversation_artifacts(session, payload.conversation_id)
        existing = await session.get(ConversationArtifactTombstoneRow, payload.conversation_id)
        if existing is not None and (existing.user_id != payload.user_id or existing.org_id != payload.org_id):
            raise ConflictError("conversation cleanup ownership does not match the existing tombstone")
        await session.execute(
            insert(ConversationArtifactTombstoneRow)
            .values(
                conversation_id=payload.conversation_id,
                user_id=payload.user_id,
                org_id=payload.org_id,
                created_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing(index_elements=[ConversationArtifactTombstoneRow.conversation_id])
        )

    async with factory() as session:
        documents = list(
            (
                await session.scalars(
                    select(DocumentRow).where(
                        DocumentRow.conversation_id == payload.conversation_id,
                        DocumentRow.user_id == payload.user_id,
                        or_(DocumentRow.org_id == payload.org_id, DocumentRow.org_id.is_(None)),
                        DocumentRow.kind == "artifact",
                    )
                )
            ).all()
        )
        generations = list(
            (
                await session.scalars(
                    select(ArtifactGenerationRow).where(
                        ArtifactGenerationRow.conversation_id == payload.conversation_id,
                        ArtifactGenerationRow.user_id == payload.user_id,
                    )
                )
            ).all()
        )
        generation_ids = [row.id for row in generations]
        blocks = (
            list(
                (
                    await session.scalars(
                        select(ArtifactBlockVersionRow).where(ArtifactBlockVersionRow.generation_id.in_(generation_ids))
                    )
                ).all()
            )
            if generation_ids
            else []
        )
        staged_media = list(
            (
                await session.scalars(
                    select(StagedMediaRow).where(
                        StagedMediaRow.conversation_id == payload.conversation_id,
                        StagedMediaRow.user_id == payload.user_id,
                        StagedMediaRow.org_id == payload.org_id,
                    )
                )
            ).all()
        )

    object_refs = {(row.object_bucket, row.object_key) for row in documents if row.object_bucket and row.object_key}
    object_refs.update((row.object_bucket, row.object_key) for row in blocks if row.object_bucket and row.object_key)
    object_refs.update(
        (row.object_bucket, row.object_key) for row in staged_media if row.object_bucket and row.object_key
    )
    store = ObjectStore()
    for bucket, key in object_refs:
        await anyio.to_thread.run_sync(partial(store.delete, bucket=bucket, key=key))
    variant_prefixes = {
        (row.object_bucket, f"variants/{row.object_sha256}")
        for row in documents
        if row.object_bucket
        and row.object_sha256
        and (row.source_mime_type or row.mime_type).lower().startswith("image/")
    }
    for bucket, key_prefix in variant_prefixes:
        await anyio.to_thread.run_sync(partial(store.delete_prefix, bucket=bucket, key_prefix=key_prefix))

    generation_scope = select(ArtifactGenerationRow.id).where(
        ArtifactGenerationRow.conversation_id == payload.conversation_id,
        ArtifactGenerationRow.user_id == payload.user_id,
    )
    async with factory() as session, write_tx(session):
        deleted_blocks = (
            await session.execute(
                delete(ArtifactBlockVersionRow)
                .where(ArtifactBlockVersionRow.generation_id.in_(generation_scope))
                .returning(ArtifactBlockVersionRow.object_bucket, ArtifactBlockVersionRow.object_key)
            )
        ).all()
        deleted_generations = (
            await session.execute(
                delete(ArtifactGenerationRow)
                .where(
                    ArtifactGenerationRow.conversation_id == payload.conversation_id,
                    ArtifactGenerationRow.user_id == payload.user_id,
                )
                .returning(ArtifactGenerationRow.id)
            )
        ).all()
        deleted_staged_media = (
            await session.execute(
                delete(StagedMediaRow)
                .where(
                    StagedMediaRow.conversation_id == payload.conversation_id,
                    StagedMediaRow.user_id == payload.user_id,
                    StagedMediaRow.org_id == payload.org_id,
                )
                .returning(StagedMediaRow.object_bucket, StagedMediaRow.object_key)
            )
        ).all()
        deleted_documents = (
            await session.execute(
                delete(DocumentRow)
                .where(
                    DocumentRow.conversation_id == payload.conversation_id,
                    DocumentRow.user_id == payload.user_id,
                    or_(DocumentRow.org_id == payload.org_id, DocumentRow.org_id.is_(None)),
                    DocumentRow.kind == "artifact",
                )
                .returning(
                    DocumentRow.object_bucket,
                    DocumentRow.object_key,
                    DocumentRow.object_sha256,
                    DocumentRow.source_mime_type,
                    DocumentRow.mime_type,
                )
            )
        ).all()

    deleted_refs = {
        (row.object_bucket, row.object_key)
        for row in deleted_blocks
        if row.object_bucket and row.object_key
    }
    deleted_refs.update(
        (row.object_bucket, row.object_key)
        for row in deleted_staged_media
        if row.object_bucket and row.object_key
    )
    deleted_refs.update(
        (row.object_bucket, row.object_key)
        for row in deleted_documents
        if row.object_bucket and row.object_key
    )
    for bucket, key in deleted_refs - object_refs:
        await anyio.to_thread.run_sync(partial(store.delete, bucket=bucket, key=key))
    deleted_variant_prefixes = {
        (row.object_bucket, f"variants/{row.object_sha256}")
        for row in deleted_documents
        if row.object_bucket
        and row.object_sha256
        and (row.source_mime_type or row.mime_type).lower().startswith("image/")
    }
    for bucket, key_prefix in deleted_variant_prefixes - variant_prefixes:
        await anyio.to_thread.run_sync(partial(store.delete_prefix, bucket=bucket, key_prefix=key_prefix))

    return CleanupConversationArtifactsResult(
        conversation_id=payload.conversation_id,
        deleted_documents=len(deleted_documents),
        deleted_generations=len(deleted_generations),
        deleted_blocks=len(deleted_blocks),
        deleted_staged_media=len(deleted_staged_media),
        deleted_objects=len(object_refs | deleted_refs),
    )
