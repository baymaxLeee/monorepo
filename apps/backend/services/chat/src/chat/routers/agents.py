"""Agent runtime endpoints."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from chat.db import get_session_factory
from chat.deps import AuthContext, CurrentUser, DbSession, RedisClient
from chat.redis_client import get_redis
from chat.schemas.agent import AgentRunResult, RunAgentInput
from chat.services.admin_client import ProviderSnapshot, get_admin_client
from chat.services.agent_runtime import AgentRunService
from chat.services.agent_streams import AgentStreamService

router = APIRouter(prefix="/conversations/{conversation_id}/agents", tags=["agents"])
logger = logging.getLogger(__name__)
_RUN_TASKS: set[asyncio.Task[None]] = set()


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
    redis: RedisClient,
) -> StreamingResponse:
    """Start or join a conversation agent run and stream Redis-backed events."""

    provider = await get_admin_client().get_provider(
        user_id=current_user.user_id,
        provider_id=payload.provider_id,
    )
    stream_service = AgentStreamService(redis, session, current_user)
    run = await stream_service.start_run(conversation_id)
    if run.started:
        _track_task(
            asyncio.create_task(
                _run_agent_to_stream(
                    conversation_id=conversation_id,
                    payload=payload,
                    current_user=current_user,
                    provider=provider,
                    run_id=run.run_id,
                )
            )
        )

    return _sse_response(_stream_saved_events(stream_service, conversation_id, run.run_id))


@router.get("/run/stream")
async def resume_agent_run(
    conversation_id: str,
    current_user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
) -> StreamingResponse:
    """Replay and continue the current in-flight agent run, if one exists."""

    stream_service = AgentStreamService(redis, session, current_user)
    run_id = await stream_service.active_run_id(conversation_id)
    if run_id is None:
        return _sse_response(_empty_stream())
    return _sse_response(_stream_saved_events(stream_service, conversation_id, run_id))


def _track_task(task: asyncio.Task[None]) -> None:
    _RUN_TASKS.add(task)

    def _on_done(done_task: asyncio.Task[None]) -> None:
        _RUN_TASKS.discard(done_task)
        try:
            done_task.result()
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("agent stream background task failed")

    task.add_done_callback(_on_done)


async def _run_agent_to_stream(
    *,
    conversation_id: str,
    payload: RunAgentInput,
    current_user: AuthContext,
    provider: ProviderSnapshot,
    run_id: str,
) -> None:
    factory = get_session_factory()
    async with factory() as session:
        stream_service = AgentStreamService(get_redis(), session, current_user)
        try:
            service = AgentRunService(session, current_user, provider)
            async for event in service.stream_run(
                conversation_id=conversation_id,
                prompt=payload.prompt,
                document_ids=payload.document_ids,
                thinking=payload.thinking,
                reasoning_effort=payload.reasoning_effort,
            ):
                await stream_service.append_event(
                    conversation_id=conversation_id,
                    run_id=run_id,
                    event=event,
                )
        except Exception as exc:
            await stream_service.append_event(
                conversation_id=conversation_id,
                run_id=run_id,
                event={"type": "error", "message": str(exc)},
            )
        finally:
            await stream_service.finish_run(conversation_id=conversation_id, run_id=run_id)


async def _stream_saved_events(
    stream_service: AgentStreamService,
    conversation_id: str,
    run_id: str,
) -> AsyncIterator[bytes]:
    try:
        async for event in stream_service.stream_events(
            conversation_id=conversation_id,
            run_id=run_id,
        ):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode()
            await asyncio.sleep(0)
    finally:
        yield b"data: [DONE]\n\n"


async def _empty_stream() -> AsyncIterator[bytes]:
    yield b"data: [DONE]\n\n"


def _sse_response(event_stream: AsyncIterator[bytes]) -> StreamingResponse:
    return StreamingResponse(
        event_stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
