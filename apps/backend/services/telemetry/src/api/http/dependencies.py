"""FastAPI dependencies."""

from collections.abc import AsyncGenerator
from typing import Annotated

from application.auth import AuthContext, OptionalAuthContext
from fastapi import Depends, Header, Request
from infrastructure.persistence.database import get_db_session
from kernel.errors import UnauthorizedError
from sqlalchemy.ext.asyncio import AsyncSession


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",", maxsplit=1)[0].strip()
    return request.client.host if request.client else ""


async def db_session() -> AsyncGenerator[AsyncSession]:
    async for session in get_db_session():
        yield session


def _parse_roles(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return ()
    return tuple(role.strip() for role in raw.split(",") if role.strip())


def optional_auth_context(
    request: Request,
    x_auth_user_id: Annotated[str | None, Header(alias="X-Auth-User-ID")] = None,
    x_auth_name: Annotated[str | None, Header(alias="X-Auth-Name")] = None,
    x_auth_email: Annotated[str | None, Header(alias="X-Auth-Email")] = None,
    x_auth_roles: Annotated[str | None, Header(alias="X-Auth-Roles")] = None,
) -> OptionalAuthContext:
    user_id = x_auth_user_id or None
    return OptionalAuthContext(
        user_id=user_id,
        username=(x_auth_name or user_id) if user_id else None,
        email=x_auth_email or None,
        client_ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        roles=_parse_roles(x_auth_roles),
    )


def auth_context(
    ctx: Annotated[OptionalAuthContext, Depends(optional_auth_context)],
) -> AuthContext:
    if not ctx.user_id:
        raise UnauthorizedError("X-Auth-User-ID header is required")
    return AuthContext(
        user_id=ctx.user_id,
        username=ctx.username or ctx.user_id,
        email=ctx.email or "",
        roles=ctx.roles,
    )


DbSession = Annotated[AsyncSession, Depends(db_session)]
CurrentUser = Annotated[AuthContext, Depends(auth_context)]
OptionalUser = Annotated[OptionalAuthContext, Depends(optional_auth_context)]
