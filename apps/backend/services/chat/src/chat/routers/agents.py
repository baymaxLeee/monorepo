"""Agent runtime endpoints."""

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

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


@router.post("/run/stream")
async def stream_agent_run(
    conversation_id: str,
    payload: RunAgentInput,
    current_user: CurrentUser,
    session: DbSession,
) -> StreamingResponse:
    """Run the conversation agent and stream high-level progress over SSE."""

    provider = await get_admin_client().get_provider(
        user_id=current_user.user_id,
        provider_id=payload.provider_id,
    )
    service = AgentRunService(session, current_user, provider)

    async def event_stream() -> AsyncIterator[bytes]:
        try:
            async for event in service.stream_run(
                conversation_id=conversation_id,
                prompt=payload.prompt,
                document_ids=payload.document_ids,
                thinking=payload.thinking,
                reasoning_effort=payload.reasoning_effort,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode()
        except Exception as exc:
            error = {"type": "error", "message": str(exc)}
            yield f"data: {json.dumps(error, ensure_ascii=False)}\n\n".encode()
        finally:
            yield b"data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
