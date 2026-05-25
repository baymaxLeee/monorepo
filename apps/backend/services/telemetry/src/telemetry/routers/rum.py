"""RUM ingestion endpoints."""

from fastapi import APIRouter, Response, status

from telemetry.deps import ClickHouse, OptionalUser
from telemetry.schemas.rum_batch import RumBatch
from telemetry.services.ingestion import ingest_batch

router = APIRouter(prefix="/rum", tags=["rum"])


@router.post("/batch", status_code=status.HTTP_204_NO_CONTENT)
async def batch(payload: RumBatch, client: ClickHouse, current_user: OptionalUser) -> Response:
    ingest_batch(client, payload, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
