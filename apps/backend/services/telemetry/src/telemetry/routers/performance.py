"""Performance query endpoints."""

from typing import Annotated

from fastapi import APIRouter, Query

from telemetry.deps import CurrentUser, DbSession
from telemetry.schemas.performance import PerformanceListResponse
from telemetry.services.performance import get_performance

router = APIRouter(prefix="/performance", tags=["performance"])


@router.get("", response_model=PerformanceListResponse)
async def list_performance_events(
    session: DbSession,
    current_user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> PerformanceListResponse:
    return await get_performance(session, current_user, limit)
