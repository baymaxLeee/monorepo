"""RUM ingestion endpoints."""

from application.contracts.rum_batch import RumBatch
from application.ingestion import ingest_batch
from fastapi import APIRouter, Response, status

from api.http.dependencies import DbSession, OptionalUser

router = APIRouter(prefix="/rum", tags=["rum"])


@router.post("/batch", status_code=status.HTTP_204_NO_CONTENT)
async def batch(payload: RumBatch, session: DbSession, current_user: OptionalUser) -> Response:
    await ingest_batch(session, payload, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
