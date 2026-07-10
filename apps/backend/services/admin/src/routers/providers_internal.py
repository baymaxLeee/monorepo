"""Internal model provider API (service-to-service).

Mounted under `/internal/providers/...`. Gateway DOES NOT forward `/internal/*`
to the public surface — only sibling microservices reach this with a valid
`X-Internal-Token` header. Responses include the **decrypted** `api_key` and
MUST be considered tier-1 secrets in transit (HTTPS / cluster-internal mesh).
"""

from typing import Annotated

from deps import AuthContext, DbSession, InternalCaller
from fastapi import APIRouter, Query
from schemas.provider import InternalModelProvider
from services.providers import ModelProviderService

router = APIRouter(prefix="/internal/providers", tags=["internal-providers"])


def _service(session: DbSession, org_id: str = "") -> ModelProviderService:
    """Construct a provider service for internal (service-to-service) use.

    The `/default` and `/by-kind` selectors search a team's shared provider
    pool and take `org_id`; by-id resolve also requires `org_id` so decrypted
    keys never cross tenant boundaries.
    """

    return ModelProviderService(session, AuthContext(user_id="", username="", email="", org_id=org_id))


@router.get("/default", response_model=InternalModelProvider)
async def get_default_provider_internal(
    org_id: Annotated[str, Query(min_length=1, description="Team that owns the provider")],
    session: DbSession,
    _caller: InternalCaller,
) -> InternalModelProvider:
    return await _service(session, org_id).get_default_for_org(org_id)


@router.get("/by-kind/{kind}", response_model=InternalModelProvider)
async def get_provider_by_kind_internal(
    kind: str,
    org_id: Annotated[str, Query(min_length=1, description="Team that owns the provider")],
    session: DbSession,
    _caller: InternalCaller,
) -> InternalModelProvider:
    """First enabled provider of `kind` (embedding/rerank/...) for the team.

    Used by knowledge to resolve the embedding/rerank model for RAG. Non-chat
    kinds have no default flag, so this returns the newest enabled one.
    """
    return await _service(session, org_id).get_by_kind_for_org(org_id, kind)


@router.get("/{provider_id}", response_model=InternalModelProvider)
async def get_provider_internal(
    provider_id: str,
    org_id: Annotated[str, Query(min_length=1, description="Team that owns the provider")],
    session: DbSession,
    _caller: InternalCaller,
) -> InternalModelProvider:
    return await _service(session, org_id).get_internal(provider_id, org_id)
