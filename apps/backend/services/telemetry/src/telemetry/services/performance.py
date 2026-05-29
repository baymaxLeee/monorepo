"""Performance query service."""

from sqlalchemy.ext.asyncio import AsyncSession

from telemetry.crud.performance import list_performance
from telemetry.deps import AuthContext
from telemetry.schemas.performance import PerformanceEvent, PerformanceListResponse


async def get_performance(
    session: AsyncSession,
    current_user: AuthContext,
    limit: int,
) -> PerformanceListResponse:
    items = await list_performance(session, current_user, limit)
    return PerformanceListResponse(items=[PerformanceEvent(**item) for item in items])
