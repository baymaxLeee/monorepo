"""Publish editable document content before atomically changing its semantic reference."""

from datetime import datetime
from typing import Any
from uuid import uuid4

from infrastructure.persistence.database import write_tx
from infrastructure.persistence.models.document import DocumentRow
from infrastructure.persistence.repositories import documents
from kernel.errors import ConflictError, NotFoundError
from sqlalchemy.ext.asyncio import AsyncSession

from application.conversation_cleanup import assert_conversation_accepts_artifacts
from application.document_content import store_document_text
from application.storage_client import ensure_document_claim_active


async def apply_document_edit(
    session: AsyncSession, snapshot: DocumentRow, values: dict[str, Any], *, expected_updated_at: datetime | None = None
) -> DocumentRow:
    if snapshot.kind == "artifact" and not snapshot.editable_source and "content_md" in values:
        raise ConflictError("immutable artifacts require a new snapshot")
    expected = expected_updated_at or snapshot.updated_at
    if snapshot.updated_at != expected:
        raise ConflictError("document changed while the revision was being generated")
    if snapshot.editable_source and "content_md" in values:
        if not snapshot.tenant_id or not snapshot.workspace_id:
            raise ConflictError("document ownership must be resolved before publishing content")
        revision = await store_document_text(
            tenant_id=snapshot.tenant_id,
            workspace_id=snapshot.workspace_id,
            user_id=snapshot.user_id,
            filename=values.get("filename", snapshot.filename),
            media_type=values.get("mime_type", snapshot.mime_type),
            content=values["content_md"],
            operation_id=f"document:{snapshot.id}:{uuid4().hex}",
        )
        values = {
            **values,
            "asset_id": revision.asset_id,
            "source_revision_id": revision.revision_id,
            "source_sha256": revision.sha256,
            "source_size": revision.size_bytes,
            "source_mime_type": revision.media_type,
            "source_filename": revision.filename,
        }
    async with write_tx(session):
        await assert_conversation_accepts_artifacts(
            session, user_id=snapshot.user_id, conversation_id=snapshot.conversation_id
        )
        row = await documents.get_document(session, snapshot.id, snapshot.user_id)
        if row is None:
            raise NotFoundError("document was deleted")
        updated = await documents.update_document_if_unchanged(session, row, values, expected_updated_at=expected)
        if updated is None:
            raise ConflictError("document changed while the revision was being generated")
        if "asset_id" in values:
            await ensure_document_claim_active(
                session,
                tenant_id=updated.tenant_id or "",
                workspace_id=updated.workspace_id or "",
                document_id=updated.id,
                asset_id=values["asset_id"],
                revision_id=values["source_revision_id"],
            )
    return updated
