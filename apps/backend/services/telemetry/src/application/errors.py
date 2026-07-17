"""Error query service."""

from infrastructure.persistence.repositories.errors import list_errors
from sqlalchemy.ext.asyncio import AsyncSession

from application.auth import AuthContext
from application.contracts.error import ErrorEvent, ErrorListResponse


async def get_errors(
    session: AsyncSession,
    current_user: AuthContext,
    limit: int,
) -> ErrorListResponse:
    items = await list_errors(session, current_user, limit)
    return ErrorListResponse(items=[ErrorEvent(**item) for item in items])
