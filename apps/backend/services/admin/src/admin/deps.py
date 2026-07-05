"""FastAPI dependencies."""

import hmac
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header
from kernel.errors import ForbiddenError, UnauthorizedError
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db_session
from .redis_client import get_redis

# Platform role (issued by iam via X-Auth-Roles). It grants platform authority
# (global app registry, org lifecycle) and is ORTHOGONAL to the org role
# (X-Auth-Org-Role) that governs writes to a team's own config.
PLATFORM_SUPER_ADMIN = "super_admin"


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    username: str
    email: str
    org_id: str = ""
    org_role: str = ""
    roles: tuple[str, ...] = ()

    @property
    def is_super_admin(self) -> bool:
        return PLATFORM_SUPER_ADMIN in self.roles

    @property
    def is_org_admin(self) -> bool:
        return self.org_role == "org_admin"

    @property
    def can_write_org_config(self) -> bool:
        """Team-shared org config (bots/scenes/intentions/providers) writes: an
        org_admin of the active org, or a super_admin who is scoped to an org.
        A super_admin with no active org must not write org data unscoped."""
        return self.is_org_admin or (self.is_super_admin and self.org_id != "")


async def db_session() -> AsyncGenerator[AsyncSession]:
    async for session in get_db_session():
        yield session


def redis_client() -> Redis:
    return get_redis()


def auth_user_id(
    x_auth_user_id: Annotated[str | None, Header(alias="X-Auth-User-ID")] = None,
) -> str:
    """Caller identity propagated by gateway after token verification.

    Internal services trust this header unconditionally; the gateway is the
    only ingress and strips inbound X-Auth-* before forwarding.
    """
    if not x_auth_user_id:
        raise UnauthorizedError("X-Auth-User-ID header is required")
    return x_auth_user_id


def auth_user_name(
    x_auth_name: Annotated[str | None, Header(alias="X-Auth-Name")] = None,
) -> str:
    """Display name propagated by gateway, used for demo owner labels."""
    return x_auth_name or ""


def auth_org_id(
    x_auth_org_id: Annotated[str | None, Header(alias="X-Auth-Org-ID")] = None,
) -> str:
    """Active org propagated by gateway. Scopes team-owned resources."""
    return x_auth_org_id or ""


def auth_roles(
    x_auth_roles: Annotated[str | None, Header(alias="X-Auth-Roles")] = None,
) -> tuple[str, ...]:
    """Roles propagated by gateway from the verified JWT (comma-separated)."""
    if not x_auth_roles:
        return ()
    return tuple(role.strip() for role in x_auth_roles.split(",") if role.strip())


def auth_org_role(
    x_auth_org_role: Annotated[str | None, Header(alias="X-Auth-Org-Role")] = None,
) -> str:
    """Org role for the active org propagated by gateway (org_admin|member)."""
    return x_auth_org_role or ""


def auth_context(
    user_id: Annotated[str, Depends(auth_user_id)],
    username: Annotated[str, Depends(auth_user_name)],
    org_id: Annotated[str, Depends(auth_org_id)],
    org_role: Annotated[str, Depends(auth_org_role)],
    roles: Annotated[tuple[str, ...], Depends(auth_roles)],
    x_auth_email: Annotated[str | None, Header(alias="X-Auth-Email")] = None,
) -> AuthContext:
    return AuthContext(
        user_id=user_id,
        username=username or user_id,
        email=x_auth_email or "",
        org_id=org_id,
        org_role=org_role,
        roles=roles,
    )


def require_admin(
    current_user: Annotated[AuthContext, Depends(auth_context)],
) -> AuthContext:
    """Write guard for team-shared org config: an org_admin of the active org,
    or a super_admin scoped to an org."""
    if not current_user.can_write_org_config:
        raise ForbiddenError("org_admin role required")
    return current_user


def require_super_admin(
    current_user: Annotated[AuthContext, Depends(auth_context)],
) -> AuthContext:
    """Platform guard: only super_admin may manage global platform resources
    (the app registry)."""
    if not current_user.is_super_admin:
        raise ForbiddenError("super_admin role required")
    return current_user


def internal_service_token(
    x_internal_token: Annotated[str | None, Header(alias="X-Internal-Token")] = None,
) -> None:
    """Shared-secret check for service-to-service `/internal/*` calls.

    Constant-time comparison; refuses when the configured token is empty so
    we never accidentally accept un-authenticated traffic in misconfigured
    environments.
    """

    expected = get_settings().internal_api_token
    if not expected or not x_internal_token or not hmac.compare_digest(expected, x_internal_token):
        raise UnauthorizedError("invalid or missing X-Internal-Token header")


DbSession = Annotated[AsyncSession, Depends(db_session)]
RedisClient = Annotated[Redis, Depends(redis_client)]
AuthUserID = Annotated[str, Depends(auth_user_id)]
AuthUserName = Annotated[str, Depends(auth_user_name)]
CurrentUser = Annotated[AuthContext, Depends(auth_context)]
AdminUser = Annotated[AuthContext, Depends(require_admin)]
SuperAdminUser = Annotated[AuthContext, Depends(require_super_admin)]
InternalCaller = Annotated[None, Depends(internal_service_token)]
