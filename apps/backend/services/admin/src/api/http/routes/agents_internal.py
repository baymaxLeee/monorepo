"""Internal agent-resolution API (service-to-service).

Mounted under `/internal/agents/...`. Gateway DOES NOT forward `/internal/*` to
the public surface — only sibling microservices reach this with a valid
`X-Internal-Token` header. `GET /internal/agents/{id}` returns the agent's
per-capability providers fully resolved (text/image/video), each including the
**decrypted** `api_key`; treat responses as tier-1 secrets in transit. Chat
resolves this once per run and passes providers through, so no tool/workflow/
step re-fetches a provider.
"""

from typing import Annotated

from application.bots import BotService
from application.contracts.bot import ResolvedAgent
from fastapi import APIRouter, Query

from api.http.dependencies import AuthContext, DbSession, InternalCaller

router = APIRouter(prefix="/internal/agents", tags=["internal-agents"])


@router.get("/{agent_id}", response_model=ResolvedAgent)
async def get_resolved_agent_internal(
    agent_id: str,
    user_id: Annotated[str, Query(min_length=1, description="Requesting user")],
    session: DbSession,
    _caller: InternalCaller,
    org_id: Annotated[str, Query(description="Requester's active org (team scope)")] = "",
) -> ResolvedAgent:
    service = BotService(session, AuthContext(user_id=user_id, username=user_id, email="", org_id=org_id))
    return await service.get_resolved(agent_id)
