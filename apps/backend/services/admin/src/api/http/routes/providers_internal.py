"""Internal model provider API (service-to-service).

Mounted under `/internal/providers/...`. Gateway DOES NOT forward `/internal/*`
to the public surface — only sibling microservices reach this with a valid
`X-Internal-Token` header. Responses include the **decrypted** `api_key` and
MUST be considered tier-1 secrets in transit (HTTPS / cluster-internal mesh).
"""

from typing import Annotated

from application.auth import AuthContext
from application.contracts.provider import InternalModelProvider, ProviderCatalogItem
from application.providers import ModelProviderService
from fastapi import APIRouter, Header, Query
from kernel.errors import ForbiddenError

from api.http.dependencies import DbSession, InternalCaller

router = APIRouter(prefix="/internal/providers", tags=["internal-providers"])


@router.get("", response_model=list[ProviderCatalogItem])
async def list_provider_catalog_internal(
    workspace_id: Annotated[str, Query(min_length=1, description="Team that owns the provider")],
    tenant_id: Annotated[str, Query(min_length=1, description="Tenant that owns the provider")],
    session: DbSession,
    _caller: InternalCaller,
) -> list[ProviderCatalogItem]:
    return await _service(session, workspace_id, tenant_id).list_internal_catalog()


def _service(session: DbSession, workspace_id: str = "", tenant_id: str = "") -> ModelProviderService:
    """Construct a provider service for internal (service-to-service) use.

    The `/default` and `/by-kind` selectors search a team's shared provider
    pool and take `workspace_id`; by-id resolve also requires `workspace_id` so decrypted
    keys never cross tenant boundaries.
    """
    return ModelProviderService(
        session, AuthContext(user_id="", username="", email="", workspace_id=workspace_id, tenant_id=tenant_id)
    )


@router.get("/default", response_model=InternalModelProvider)
async def get_default_provider_internal(
    workspace_id: Annotated[str, Query(min_length=1, description="Team that owns the provider")],
    tenant_id: Annotated[str, Query(min_length=1, description="Team that owns the provider")],
    session: DbSession,
    _caller: InternalCaller,
) -> InternalModelProvider:
    return await _service(session, workspace_id, tenant_id).get_default_for_workspace(workspace_id, tenant_id)


@router.get("/by-kind/{kind}", response_model=InternalModelProvider)
async def get_provider_by_kind_internal(
    kind: str,
    workspace_id: Annotated[str, Query(min_length=1, description="Team that owns the provider")],
    tenant_id: Annotated[str, Query(min_length=1, description="Team that owns the provider")],
    session: DbSession,
    _caller: InternalCaller,
) -> InternalModelProvider:
    """First enabled provider of `kind` (embedding/rerank/...) for the team.

    Used by knowledge to resolve the embedding/rerank model for RAG. Non-chat
    kinds have no default flag, so this returns the newest enabled one.
    """
    return await _service(session, workspace_id, tenant_id).get_by_kind_for_workspace(workspace_id, tenant_id, kind)


@router.get("/{provider_id}", response_model=InternalModelProvider)
async def get_provider_internal(
    provider_id: str,
    workspace_id: Annotated[str, Query(min_length=1, description="Team that owns the provider")],
    tenant_id: Annotated[str, Query(min_length=1, description="Team that owns the provider")],
    session: DbSession,
    _caller: InternalCaller,
) -> InternalModelProvider:
    return await _service(session, workspace_id, tenant_id).get_internal(provider_id, workspace_id, tenant_id)


@router.get("/{provider_id}/task-credentials", response_model=InternalModelProvider)
async def get_task_provider_internal(
    provider_id: str,
    workspace_id: Annotated[str, Query(min_length=1)],
    tenant_id: Annotated[str, Query(min_length=1)],
    caller: Annotated[str, Header(alias="X-Caller-Service")],
    session: DbSession,
    _caller: InternalCaller,
) -> InternalModelProvider:
    if caller not in {"canvas", "executor"}:
        raise ForbiddenError("Only Canvas or Executor may resolve credentials for existing tasks")
    return await _service(session, workspace_id, tenant_id).get_internal(
        provider_id, workspace_id, tenant_id, allow_disabled=True
    )
