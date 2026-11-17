"""FastAPI dependencies."""

from collections.abc import AsyncGenerator
from typing import Annotated

from application.auth import AuthContext
from fastapi import Depends, Header
from infrastructure.persistence.database import get_db_session
from knowledge_kernel.errors import UnauthorizedError
from sqlalchemy.ext.asyncio import AsyncSession


async def db_session() -> AsyncGenerator[AsyncSession]:
    async for session in get_db_session():
        yield session


def auth_user_id(
    x_auth_user_id: Annotated[str | None, Header(alias="X-Auth-User-ID")] = None,
) -> str:
    if not x_auth_user_id:
        raise UnauthorizedError("X-Auth-User-ID header is required")
    return x_auth_user_id


def auth_workspace_id(
    x_auth_workspace_id: Annotated[str | None, Header(alias="X-Auth-Workspace-ID")] = None,
) -> str:
    """Active workspace propagated by gateway. Required for team-scoped knowledge."""
    if not x_auth_workspace_id:
        raise UnauthorizedError("X-Auth-Workspace-ID header is required")
    return x_auth_workspace_id


def auth_tenant_id(
    x_auth_tenant_id: Annotated[str | None, Header(alias="X-Auth-Tenant-ID")] = None,
) -> str:
    """Active tenant propagated by gateway. Required for team-scoped knowledge."""
    if not x_auth_tenant_id:
        raise UnauthorizedError("X-Auth-Tenant-ID header is required")
    return x_auth_tenant_id


def auth_workspace_role(
    x_auth_workspace_role: Annotated[str | None, Header(alias="X-Auth-Workspace-Role")] = None,
) -> str:
    """Workspace role for the active workspace propagated by gateway (workspace_admin|member)."""
    return x_auth_workspace_role or ""


def auth_context(
    user_id: Annotated[str, Depends(auth_user_id)],
    workspace_id: Annotated[str, Depends(auth_workspace_id)],
    tenant_id: Annotated[str, Depends(auth_tenant_id)],
    workspace_role: Annotated[str, Depends(auth_workspace_role)],
    x_auth_name: Annotated[str | None, Header(alias="X-Auth-Name")] = None,
    x_auth_email: Annotated[str | None, Header(alias="X-Auth-Email")] = None,
) -> AuthContext:
    return AuthContext(
        user_id=user_id,
        username=x_auth_name or user_id,
        email=x_auth_email or "",
        workspace_id=workspace_id,
        tenant_id=tenant_id,
        workspace_role=workspace_role,
    )


DbSession = Annotated[AsyncSession, Depends(db_session)]
CurrentUser = Annotated[AuthContext, Depends(auth_context)]
