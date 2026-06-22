"""Agent runtime endpoints."""

from fastapi import APIRouter

from chat.deps import CurrentUser, DbSession
from chat.schemas.agent import AgentRunResult, RunAgentInput
from chat.services.admin_client import get_admin_client
from chat.services.agent_runtime import AgentRunService

router = APIRouter(prefix="/conversations/{conversation_id}/agents", tags=["agents"])


@router.post("/run", response_model=AgentRunResult)
async def run_agent(
    conversation_id: str,
    payload: RunAgentInput,
    current_user: CurrentUser,
    session: DbSession,
) -> AgentRunResult:
    """Run an OpenAI Agents SDK agent with conversation document tools."""

    provider = await get_admin_client().get_provider(
        user_id=current_user.user_id,
        provider_id=payload.provider_id,
    )
    return await AgentRunService(session, current_user, provider).run(
        conversation_id=conversation_id,
        prompt=payload.prompt,
        document_ids=payload.document_ids,
        thinking=payload.thinking,
        reasoning_effort=payload.reasoning_effort,
    )
