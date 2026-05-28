"""Internal model provider API (service-to-service).

Mounted under `/internal/providers/...`. Gateway DOES NOT forward `/internal/*`
to the public surface — only sibling microservices reach this with a valid
`X-Internal-Token` header. Responses include the **decrypted** `api_key` and
MUST be considered tier-1 secrets in transit (HTTPS / cluster-internal mesh).
"""

from typing import Annotated

from fastapi import APIRouter, Query

from admin.deps import AuthContext, DbSession, InternalCaller
from admin.schemas.provider import InternalModelProvider
from admin.services.providers import ModelProviderService

router = APIRouter(prefix="/internal/providers", tags=["internal-providers"])


def _service_for(session: DbSession, user_id: str) -> ModelProviderService:
    """Construct a service bound to the caller-specified owner.

    Internal callers (chat, …) supply the end-user via `user_id` query —
    we still go through `ModelProviderService` so audit/log boundaries
    stay consistent with the public CRUD path.
    """

    return ModelProviderService(session, AuthContext(user_id=user_id, username=user_id, email=""))


@router.get("/default", response_model=InternalModelProvider)
async def get_default_provider_internal(
    user_id: Annotated[str, Query(min_length=1, description="Owner of the provider")],
    session: DbSession,
    _caller: InternalCaller,
) -> InternalModelProvider:
    return await _service_for(session, user_id).get_default_for_user(user_id)


@router.get("/{provider_id}", response_model=InternalModelProvider)
async def get_provider_internal(
    provider_id: str,
    user_id: Annotated[str, Query(min_length=1, description="Owner of the provider")],
    session: DbSession,
    _caller: InternalCaller,
) -> InternalModelProvider:
    return await _service_for(session, user_id).get_internal(provider_id, user_id)
