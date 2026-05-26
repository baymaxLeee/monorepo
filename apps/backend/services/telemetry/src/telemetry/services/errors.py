"""Error query service."""

from sqlalchemy.ext.asyncio import AsyncSession

from telemetry.crud.errors import list_errors
from telemetry.deps import AuthContext
from telemetry.schemas.error import ErrorEvent, ErrorListResponse


async def get_errors(
    session: AsyncSession,
    current_user: AuthContext,
    limit: int,
) -> ErrorListResponse:
    items = await list_errors(session, current_user, limit)
    return ErrorListResponse(items=[ErrorEvent(**item) for item in items])
