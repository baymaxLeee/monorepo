"""Error query service."""

from crud.errors import list_errors
from deps import AuthContext
from schemas.error import ErrorEvent, ErrorListResponse
from sqlalchemy.ext.asyncio import AsyncSession


async def get_errors(
    session: AsyncSession,
    current_user: AuthContext,
    limit: int,
) -> ErrorListResponse:
    items = await list_errors(session, current_user, limit)
    return ErrorListResponse(items=[ErrorEvent(**item) for item in items])
