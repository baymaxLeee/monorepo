from datetime import UTC, datetime
from functools import partial
from hashlib import blake2b
from typing import cast

import anyio
from infrastructure.persistence.database import get_session_factory, write_tx
from infrastructure.persistence.models.conversation_cleanup import ConversationArtifactTombstoneRow
from infrastructure.persistence.models.document import DocumentRow
from infrastructure.persistence.models.file_store import (
    FileChangeSetEntryRow,
    FileChangeSetRow,
    FileEntryRow,
)
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
    return int.from_bytes(blake2b(f"conversation-artifacts:{conversation_id}".encode(), digest_size=8).digest(), "big", signed=True)


async def _lock_conversation_artifacts(session: AsyncSession, conversation_id: str) -> None:
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _conversation_lock_key(conversation_id)})


async def assert_conversation_accepts_artifacts(session: AsyncSession, *, user_id: str, conversation_id: str | None) -> None:
    if conversation_id is None:
        return
    await _lock_conversation_artifacts(session, conversation_id)
    if await session.scalar(select(ConversationArtifactTombstoneRow.conversation_id).where(ConversationArtifactTombstoneRow.conversation_id == conversation_id, ConversationArtifactTombstoneRow.user_id == user_id)):
        raise ConversationDeletedError("conversation was deleted; generated artifacts are no longer accepted")


async def cleanup_conversation_artifacts(payload: CleanupConversationArtifactsInput) -> CleanupConversationArtifactsResult:
    factory = get_session_factory()
    async with factory() as session, write_tx(session):
        await _lock_conversation_artifacts(session, payload.conversation_id)
        await session.execute(insert(ConversationArtifactTombstoneRow).values(conversation_id=payload.conversation_id, user_id=payload.user_id, org_id=payload.org_id, created_at=datetime.now(UTC)).on_conflict_do_nothing(index_elements=[ConversationArtifactTombstoneRow.conversation_id]))
        change_sets = select(FileChangeSetRow.id).where(FileChangeSetRow.user_id == payload.user_id, FileChangeSetRow.conversation_id == payload.conversation_id)
        await session.execute(delete(FileChangeSetEntryRow).where(FileChangeSetEntryRow.change_set_id.in_(change_sets)))
        await session.execute(delete(FileChangeSetRow).where(FileChangeSetRow.id.in_(change_sets)))
        deleted_files = (await session.execute(delete(FileEntryRow).where(FileEntryRow.user_id == payload.user_id, FileEntryRow.conversation_id == payload.conversation_id).returning(FileEntryRow.id))).all()
        staged = (await session.execute(delete(StagedMediaRow).where(StagedMediaRow.user_id == payload.user_id, StagedMediaRow.org_id == payload.org_id, StagedMediaRow.conversation_id == payload.conversation_id).returning(StagedMediaRow.object_bucket, StagedMediaRow.object_key))).all()
        documents = (await session.execute(delete(DocumentRow).where(DocumentRow.user_id == payload.user_id, DocumentRow.conversation_id == payload.conversation_id, or_(DocumentRow.org_id == payload.org_id, DocumentRow.org_id.is_(None)), DocumentRow.kind == "artifact").returning(DocumentRow.object_bucket, DocumentRow.object_key))).all()
    store = ObjectStore()
    deleted_objects = cast(
        list[tuple[str | None, str | None]],
        [*staged, *documents],
    )
    for object_bucket, object_key in deleted_objects:
        if object_bucket and object_key:
            await anyio.to_thread.run_sync(
                partial(store.delete, bucket=object_bucket, key=object_key),
            )
    return CleanupConversationArtifactsResult(conversation_id=payload.conversation_id, deleted_documents=len(documents), deleted_generations=0, deleted_blocks=len(deleted_files), deleted_staged_media=len(staged), deleted_objects=len(documents) + len(staged))
