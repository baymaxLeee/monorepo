"""Error query endpoints."""

from typing import Annotated

from fastapi import APIRouter, Query

from telemetry.deps import CurrentUser, DbSession
from telemetry.schemas.error import ErrorListResponse
from telemetry.services.errors import get_errors

router = APIRouter(prefix="/errors", tags=["errors"])


@router.get("", response_model=ErrorListResponse)
async def list_error_events(
    session: DbSession,
    current_user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> ErrorListResponse:
    return await get_errors(session, current_user, limit)
