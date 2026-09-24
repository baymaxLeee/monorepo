"""Register Asset revisions as Knowledge source documents."""

from application.contracts.document import CreateSourceDocumentsInput, IngestResult
from application.ingest import ingest_assets
from fastapi import APIRouter

from api.http.dependencies import CurrentUser

router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post("", response_model=IngestResult)
async def ingest(payload: CreateSourceDocumentsInput, current_user: CurrentUser) -> IngestResult:
    """Attach already-uploaded immutable Asset revisions to Knowledge."""
    return await ingest_assets(
        current_user=current_user,
        conversation_id=payload.conversation_id,
        provider_id=payload.provider_id,
        items=payload.assets,
    )
