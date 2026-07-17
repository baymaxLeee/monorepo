"""Performance query service."""

from infrastructure.persistence.repositories.performance import list_performance
from sqlalchemy.ext.asyncio import AsyncSession

from application.auth import AuthContext
from application.contracts.performance import PerformanceEvent, PerformanceListResponse


async def get_performance(
    session: AsyncSession,
    current_user: AuthContext,
    limit: int,
) -> PerformanceListResponse:
    items = await list_performance(session, current_user, limit)
    return PerformanceListResponse(items=[PerformanceEvent(**item) for item in items])
