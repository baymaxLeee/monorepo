"""FastAPI dependencies."""

from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request
from kernel.errors import UnauthorizedError
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db_session

ADMIN_USER_ID = "demo-super-admin"
ADMIN_EMAIL = "admin@example.com"


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    username: str
    email: str

    @property
    def is_admin(self) -> bool:
        return self.user_id == ADMIN_USER_ID or self.email == ADMIN_EMAIL


@dataclass(frozen=True)
class OptionalAuthContext:
    user_id: str | None
    username: str | None
    email: str | None
    client_ip: str
    user_agent: str

    @property
    def is_admin(self) -> bool:
        return self.user_id == ADMIN_USER_ID or self.email == ADMIN_EMAIL


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",", maxsplit=1)[0].strip()
    return request.client.host if request.client else ""


async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_session():
        yield session


def optional_auth_context(
    request: Request,
    x_auth_user_id: Annotated[str | None, Header(alias="X-Auth-User-ID")] = None,
    x_auth_name: Annotated[str | None, Header(alias="X-Auth-Name")] = None,
    x_auth_email: Annotated[str | None, Header(alias="X-Auth-Email")] = None,
) -> OptionalAuthContext:
    user_id = x_auth_user_id or None
    return OptionalAuthContext(
        user_id=user_id,
        username=(x_auth_name or user_id) if user_id else None,
        email=x_auth_email or None,
        client_ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
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
    )


DbSession = Annotated[AsyncSession, Depends(db_session)]
CurrentUser = Annotated[AuthContext, Depends(auth_context)]
OptionalUser = Annotated[OptionalAuthContext, Depends(optional_auth_context)]
