"""RUM ingestion endpoints."""

from deps import DbSession, OptionalUser
from fastapi import APIRouter, Response, status
from schemas.rum_batch import RumBatch
from services.ingestion import ingest_batch

router = APIRouter(prefix="/rum", tags=["rum"])


@router.post("/batch", status_code=status.HTTP_204_NO_CONTENT)
async def batch(payload: RumBatch, session: DbSession, current_user: OptionalUser) -> Response:
    await ingest_batch(session, payload, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
