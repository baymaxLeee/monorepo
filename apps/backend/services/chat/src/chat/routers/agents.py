"""Agent runtime endpoints."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from kernel.errors import BaseError

from chat.db import get_session_factory
from chat.deps import AuthContext, CurrentUser, DbSession, RedisClient
from chat.redis_client import get_redis
from chat.schemas.agent import RunAgentInput
from chat.services.admin_client import ProviderSnapshot, get_admin_client
from chat.services.agent_runtime import AgentRunService
from chat.services.agent_streams import AgentStreamService
from chat.services.artifact_slots import extract_slot_ids

router = APIRouter(prefix="/conversations/{conversation_id}/agents", tags=["agents"])
logger = logging.getLogger(__name__)
_RUN_TASKS: set[asyncio.Task[None]] = set()


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
    multimodal_provider = None
    if payload.multimodal_provider_id:
        multimodal_provider = await get_admin_client().get_provider(
            user_id=current_user.user_id,
            provider_id=payload.multimodal_provider_id,
        )
    else:
        multimodal_provider = provider
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
                    multimodal_provider=multimodal_provider,
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
    multimodal_provider: ProviderSnapshot | None,
    run_id: str,
) -> None:
    factory = get_session_factory()
    async with factory() as session:
        stream_service = AgentStreamService(get_redis(), session, current_user)
        try:
            service = AgentRunService(session, current_user, provider, multimodal_provider)
            document_ids = list(payload.document_ids)
            for slot_id in extract_slot_ids(payload.prompt):
                if slot_id not in document_ids:
                    document_ids.append(slot_id)
            async for event in service.stream_run(
                conversation_id=conversation_id,
                prompt=payload.prompt,
                document_ids=document_ids,
                thinking=payload.thinking,
                reasoning_effort=payload.reasoning_effort,
            ):
                await stream_service.append_event(
                    conversation_id=conversation_id,
                    run_id=run_id,
                    event=event,
                )
        except Exception as exc:
            logger.exception("agent stream run failed")
            await stream_service.append_event(
                conversation_id=conversation_id,
                run_id=run_id,
                event={
                    "type": "message",
                    "role": "assistant",
                    "status": "failed",
                    "text": _stream_error_text(exc),
                },
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


def _stream_error_text(exc: Exception) -> str:
    if isinstance(exc, BaseError):
        reason = exc.details.get("reason")
        if reason:
            return f"{exc.message}: {reason}"
        if exc.details:
            return f"{exc.message}: {exc.details}"
        return exc.message
    return str(exc)
