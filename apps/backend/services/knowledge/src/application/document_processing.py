"""Synchronous Knowledge-owned document conversion and indexing."""

from dataclasses import dataclass

from infrastructure.persistence.models.document import DocumentRow

from application.indexer import index_document_by_id
from application.processor import convert_document


@dataclass(frozen=True)
class DocumentProcessingResult:
    conversion: str
    indexing: str


def needs_processing(row: DocumentRow) -> bool:
    return row.kind == "source" and (
        row.ingest_status in {"received", "converting", "failed"}
        or (row.ingest_status == "ready" and row.index_status in {"pending", "indexing", "failed"})
    )


async def process_document(document_id: str, *, provider_id: str | None = None) -> DocumentProcessingResult:
    conversion = await convert_document(document_id, provider_id=provider_id)
    if conversion in {"deleted", "not-source", "failed"}:
        return DocumentProcessingResult(conversion=conversion, indexing="skipped")
    indexing = await index_document_by_id(document_id)
    return DocumentProcessingResult(conversion=conversion, indexing=indexing)
