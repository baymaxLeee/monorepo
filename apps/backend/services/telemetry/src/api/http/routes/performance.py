"""Performance query endpoints."""

from typing import Annotated

from application.contracts.performance import PerformanceListResponse
from application.performance import get_performance
from fastapi import APIRouter, Query

from api.http.dependencies import CurrentUser, DbSession

router = APIRouter(prefix="/performance", tags=["performance"])


@router.get("", response_model=PerformanceListResponse)
async def list_performance_events(
    session: DbSession,
    current_user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> PerformanceListResponse:
    return await get_performance(session, current_user, limit)
