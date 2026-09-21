"""FastAPI dependencies."""

import hmac
from collections.abc import AsyncGenerator
from typing import Annotated

from application.auth import AuthContext
from bootstrap.config import get_settings
from fastapi import Depends, Header
from infrastructure.cache.redis import get_redis
from infrastructure.persistence.database import get_db_session
from kernel.errors import ForbiddenError, UnauthorizedError
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession


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


def auth_workspace_id(
    x_auth_workspace_id: Annotated[str | None, Header(alias="X-Auth-Workspace-ID")] = None,
) -> str:
    """Active workspace propagated by gateway. Scopes team-owned resources."""
    return x_auth_workspace_id or ""


def auth_tenant_id(
    x_auth_tenant_id: Annotated[str | None, Header(alias="X-Auth-Tenant-ID")] = None,
) -> str:
    """Active tenant propagated by gateway. Scopes team-owned resources."""
    return x_auth_tenant_id or ""


def auth_roles(
    x_auth_roles: Annotated[str | None, Header(alias="X-Auth-Roles")] = None,
) -> tuple[str, ...]:
    """Roles propagated by gateway from the verified JWT (comma-separated)."""
    if not x_auth_roles:
        return ()
    return tuple(role.strip() for role in x_auth_roles.split(",") if role.strip())


def auth_workspace_role(
    x_auth_workspace_role: Annotated[str | None, Header(alias="X-Auth-Workspace-Role")] = None,
) -> str:
    """Workspace role for the active workspace propagated by gateway (workspace_admin|member)."""
    return x_auth_workspace_role or ""


def auth_context(
    user_id: Annotated[str, Depends(auth_user_id)],
    username: Annotated[str, Depends(auth_user_name)],
    workspace_id: Annotated[str, Depends(auth_workspace_id)],
    tenant_id: Annotated[str, Depends(auth_tenant_id)],
    workspace_role: Annotated[str, Depends(auth_workspace_role)],
    roles: Annotated[tuple[str, ...], Depends(auth_roles)],
    x_auth_email: Annotated[str | None, Header(alias="X-Auth-Email")] = None,
) -> AuthContext:
    return AuthContext(
        user_id=user_id,
        username=username or user_id,
        email=x_auth_email or "",
        workspace_id=workspace_id,
        tenant_id=tenant_id,
        workspace_role=workspace_role,
        roles=roles,
    )


def require_admin(
    current_user: Annotated[AuthContext, Depends(auth_context)],
) -> AuthContext:
    """Write guard for team-shared workspace config: an active workspace_admin of the bound
    workspace (no super_admin bypass — the platform role is control-plane only)."""
    if not current_user.can_write_workspace_config:
        raise ForbiddenError("workspace_admin role required")
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
    x_caller_service: Annotated[str | None, Header(alias="X-Caller-Service")] = None,
) -> None:
    """Shared-secret check for service-to-service `/internal/*` calls.

    Constant-time comparison; refuses when the configured token is empty so
    we never accidentally accept un-authenticated traffic in misconfigured
    environments.
    """

    expected = get_settings().internal_api_token
    if not expected or not x_internal_token or not hmac.compare_digest(expected, x_internal_token):
        raise UnauthorizedError("invalid or missing X-Internal-Token header")
    if x_caller_service not in {"canvas", "chat", "executor", "knowledge"}:
        raise UnauthorizedError("invalid or missing X-Caller-Service header")


DbSession = Annotated[AsyncSession, Depends(db_session)]
RedisClient = Annotated[Redis, Depends(redis_client)]
AuthUserID = Annotated[str, Depends(auth_user_id)]
AuthUserName = Annotated[str, Depends(auth_user_name)]
CurrentUser = Annotated[AuthContext, Depends(auth_context)]
AdminUser = Annotated[AuthContext, Depends(require_admin)]
SuperAdminUser = Annotated[AuthContext, Depends(require_super_admin)]
InternalCaller = Annotated[None, Depends(internal_service_token)]
