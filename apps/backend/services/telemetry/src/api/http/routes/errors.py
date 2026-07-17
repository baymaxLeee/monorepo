"""Error query endpoints."""

from typing import Annotated

from application.contracts.error import ErrorListResponse
from application.errors import get_errors
from fastapi import APIRouter, Query

from api.http.dependencies import CurrentUser, DbSession

router = APIRouter(prefix="/errors", tags=["errors"])


@router.get("", response_model=ErrorListResponse)
async def list_error_events(
    session: DbSession,
    current_user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> ErrorListResponse:
    return await get_errors(session, current_user, limit)
