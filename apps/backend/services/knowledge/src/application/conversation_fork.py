from datetime import UTC, datetime
from uuid import uuid4

from infrastructure.persistence.database import write_tx
from infrastructure.persistence.models.document import DocumentRow
from kernel.errors import ConflictError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from application.contracts.conversation_fork import ForkConversationDocumentsInput, ForkConversationDocumentsResult
from application.conversation_cleanup import assert_conversation_accepts_artifacts
from application.storage_client import ensure_document_claim_active


def snapshot_document(row: DocumentRow, payload: ForkConversationDocumentsInput) -> DocumentRow:
    if row.tenant_id != payload.tenant_id or row.workspace_id != payload.workspace_id:
        raise ConflictError("document scope does not match the conversation")
    if row.ingest_status not in {"ready", "failed"}:
        raise ConflictError("wait for document processing before creating a branch")
    if not row.asset_id or not row.source_revision_id:
        raise ConflictError("document has no immutable source revision")
    values = {column.key: getattr(row, column.key) for column in DocumentRow.__table__.columns}
    # A branch owns a frozen artifact copy, never another independently indexed
    # source upload. Deleting the branch releases only its own claims.
    values.update(
        id=uuid4().hex,
        conversation_id=payload.conversation_id,
        kind="artifact",
        editable_source=False,
        index_status="skipped",
        index_error=None,
        processing_dispatched_at=None,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    return DocumentRow(**values)


async def fork_conversation_documents(
    session: AsyncSession, payload: ForkConversationDocumentsInput
) -> ForkConversationDocumentsResult:
    async with write_tx(session):
        # Same lock as writes/deletion: copying and cleanup cannot interleave.
        for conversation_id in sorted([payload.source_conversation_id, payload.conversation_id]):
            await assert_conversation_accepts_artifacts(
                session, user_id=payload.user_id, conversation_id=conversation_id
            )
        if await session.scalar(
            select(DocumentRow.id).where(DocumentRow.conversation_id == payload.conversation_id).limit(1)
        ):
            raise ConflictError("branch document destination is not empty")
        documents = list(
            await session.scalars(
                select(DocumentRow).where(
                    DocumentRow.user_id == payload.user_id,
                    DocumentRow.conversation_id == payload.source_conversation_id,
                )
            )
        )
        snapshots = [(row, snapshot_document(row, payload)) for row in documents]
        for _original, snapshot in snapshots:
            assert snapshot.asset_id
            assert snapshot.source_revision_id
            session.add(snapshot)
            await ensure_document_claim_active(
                session,
                tenant_id=payload.tenant_id,
                workspace_id=payload.workspace_id,
                document_id=snapshot.id,
                asset_id=snapshot.asset_id,
                revision_id=snapshot.source_revision_id,
            )
        return ForkConversationDocumentsResult(document_ids={row.id: snapshot.id for row, snapshot in snapshots})
