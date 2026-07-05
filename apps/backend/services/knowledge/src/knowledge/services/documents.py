"""Document domain helpers."""

from knowledge.models.document import DocumentRow
from knowledge.schemas.document import Document


def document_to_schema(row: DocumentRow, *, include_content: bool = False) -> Document:
    return Document(
        id=row.id,
        user_id=row.user_id,
        org_id=row.org_id,
        conversation_id=row.conversation_id,
        kind=row.kind,  # type: ignore[arg-type]
        title=row.title,
        filename=row.filename,
        mime_type=row.mime_type,
        content_md=row.content_md if include_content else "",
        source_size=row.source_size,
        source_mime_type=row.source_mime_type,
        object_bucket=row.object_bucket,
        object_key=row.object_key,
        object_sha256=row.object_sha256,
        source_filename=row.source_filename,
        ingest_status=row.ingest_status,  # type: ignore[arg-type]
        ingest_progress=row.ingest_progress,
        ingest_error=row.ingest_error,
        created_at=row.created_at.isoformat(),
        updated_at=row.updated_at.isoformat(),
    )
