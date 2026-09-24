"""Register Asset revisions as Knowledge source documents."""

from application.contracts.document import (
    CreateSourceDocumentsInput,
    IngestResult,
    PrepareSourceUploadsInput,
    PrepareSourceUploadsResult,
)
from application.ingest import ingest_assets, prepare_source_uploads
from fastapi import APIRouter

from api.http.dependencies import CurrentUser

router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post(":prepare", response_model=PrepareSourceUploadsResult)
async def prepare(payload: PrepareSourceUploadsInput, current_user: CurrentUser) -> PrepareSourceUploadsResult:
    """Authorize file metadata and create resumable Asset upload capabilities."""
    return await prepare_source_uploads(
        current_user=current_user,
        conversation_id=payload.conversation_id,
        files=payload.files,
    )


@router.post("", response_model=IngestResult)
async def ingest(payload: CreateSourceDocumentsInput, current_user: CurrentUser) -> IngestResult:
    """Attach already-uploaded immutable Asset revisions to Knowledge."""
    return await ingest_assets(
        current_user=current_user,
        conversation_id=payload.conversation_id,
        provider_id=payload.provider_id,
        items=payload.uploads,
    )
