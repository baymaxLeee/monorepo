"""Performance query service."""

from crud.performance import list_performance
from deps import AuthContext
from schemas.performance import PerformanceEvent, PerformanceListResponse
from sqlalchemy.ext.asyncio import AsyncSession


async def get_performance(
    session: AsyncSession,
    current_user: AuthContext,
    limit: int,
) -> PerformanceListResponse:
    items = await list_performance(session, current_user, limit)
    return PerformanceListResponse(items=[PerformanceEvent(**item) for item in items])
