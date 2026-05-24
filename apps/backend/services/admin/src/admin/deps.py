"""FastAPI dependencies."""

from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header
from kernel.errors import UnauthorizedError
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db_session
from .redis_client import get_redis


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


async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_session():
        yield session


def redis_client() -> Redis:
    return get_redis()


def auth_user_id(
    x_auth_user_id: Annotated[str | None, Header(alias="X-Auth-User-ID")] = None,
) -> str:
    """Caller identity propagated by api-gateway after token verification.

    Internal services trust this header unconditionally; the gateway is the
    only ingress and strips inbound X-Auth-* before forwarding.
    """
    if not x_auth_user_id:
        raise UnauthorizedError("X-Auth-User-ID header is required")
    return x_auth_user_id


def auth_user_name(
    x_auth_name: Annotated[str | None, Header(alias="X-Auth-Name")] = None,
) -> str:
    """Display name propagated by api-gateway, used for demo owner labels."""
    return x_auth_name or ""


def auth_context(
    user_id: Annotated[str, Depends(auth_user_id)],
    username: Annotated[str, Depends(auth_user_name)],
    x_auth_email: Annotated[str | None, Header(alias="X-Auth-Email")] = None,
) -> AuthContext:
    return AuthContext(
        user_id=user_id,
        username=username or user_id,
        email=x_auth_email or "",
    )


DbSession = Annotated[AsyncSession, Depends(db_session)]
RedisClient = Annotated[Redis, Depends(redis_client)]
AuthUserID = Annotated[str, Depends(auth_user_id)]
AuthUserName = Annotated[str, Depends(auth_user_name)]
CurrentUser = Annotated[AuthContext, Depends(auth_context)]
