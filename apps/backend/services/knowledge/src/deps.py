"""FastAPI dependencies."""

import hmac
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Annotated

from db import get_db_session
from fastapi import Depends, Header
from kernel.errors import UnauthorizedError
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    username: str
    email: str
    org_id: str
    org_role: str = ""

    @property
    def is_org_admin(self) -> bool:
        return self.org_role == "org_admin"


async def db_session() -> AsyncGenerator[AsyncSession]:
    async for session in get_db_session():
        yield session


def auth_user_id(
    x_auth_user_id: Annotated[str | None, Header(alias="X-Auth-User-ID")] = None,
) -> str:
    if not x_auth_user_id:
        raise UnauthorizedError("X-Auth-User-ID header is required")
    return x_auth_user_id


def auth_org_id(
    x_auth_org_id: Annotated[str | None, Header(alias="X-Auth-Org-ID")] = None,
) -> str:
    """Active org propagated by gateway. Required for team-scoped knowledge."""
    if not x_auth_org_id:
        raise UnauthorizedError("X-Auth-Org-ID header is required")
    return x_auth_org_id


def auth_org_role(
    x_auth_org_role: Annotated[str | None, Header(alias="X-Auth-Org-Role")] = None,
) -> str:
    """Org role for the active org propagated by gateway (org_admin|member)."""
    return x_auth_org_role or ""


def auth_context(
    user_id: Annotated[str, Depends(auth_user_id)],
    org_id: Annotated[str, Depends(auth_org_id)],
    org_role: Annotated[str, Depends(auth_org_role)],
    x_auth_name: Annotated[str | None, Header(alias="X-Auth-Name")] = None,
    x_auth_email: Annotated[str | None, Header(alias="X-Auth-Email")] = None,
) -> AuthContext:
    return AuthContext(
        user_id=user_id,
        username=x_auth_name or user_id,
        email=x_auth_email or "",
        org_id=org_id,
        org_role=org_role,
    )


def require_internal_token(
    x_internal_token: Annotated[str | None, Header(alias="X-Internal-Token")] = None,
    x_caller_service: Annotated[str | None, Header(alias="X-Caller-Service")] = None,
) -> None:
    from config import get_settings

    expected = get_settings().internal_api_token
    if not expected or not x_internal_token or not hmac.compare_digest(expected, x_internal_token):
        raise UnauthorizedError("invalid internal token")
    if x_caller_service not in {"chat", "executor"}:
        raise UnauthorizedError("invalid or missing X-Caller-Service header")


DbSession = Annotated[AsyncSession, Depends(db_session)]
CurrentUser = Annotated[AuthContext, Depends(auth_context)]
InternalAuth = Annotated[None, Depends(require_internal_token)]
