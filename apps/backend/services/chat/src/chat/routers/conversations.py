"""Conversation HTTP router (CRUD + SSE message endpoint)."""

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from chat.deps import CurrentUser, DbSession
from chat.schemas.conversation import (
    Conversation,
    ConversationDetail,
    CreateConversationInput,
    SendMessageInput,
    UpdateConversationInput,
)
from chat.services.admin_client import get_admin_client
from chat.services.conversations import ConversationService
from chat.services.messages import MessageService

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("", response_model=list[Conversation])
async def list_conversations(
    current_user: CurrentUser,
    session: DbSession,
) -> list[Conversation]:
    return await ConversationService(session, current_user).list()


@router.post("", response_model=Conversation, status_code=201)
async def create_conversation(
    payload: CreateConversationInput,
    current_user: CurrentUser,
    session: DbSession,
) -> Conversation:
    return await ConversationService(session, current_user).create(payload)


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> ConversationDetail:
    return await ConversationService(session, current_user).get(conversation_id)


@router.patch("/{conversation_id}", response_model=Conversation)
async def update_conversation(
    conversation_id: str,
    payload: UpdateConversationInput,
    current_user: CurrentUser,
    session: DbSession,
) -> Conversation:
    return await ConversationService(session, current_user).update(conversation_id, payload)


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> None:
    await ConversationService(session, current_user).delete(conversation_id)


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    payload: SendMessageInput,
    current_user: CurrentUser,
    session: DbSession,
) -> StreamingResponse:
    """Persist user message, stream assistant reply over SSE.

    The response is `text/event-stream`. Each event is `data: <text-chunk>\\n\\n`
    where `<text-chunk>` is a JSON-encoded string (so client-side parsing is
    trivial and binary-safe). A final `data: [DONE]\\n\\n` event signals end.

    We resolve the conversation row AND the model provider **before** the
    response headers go out so 404 / `provider_not_configured` errors stay
    on the normal exception-handler path (proper status code + JSON body)
    instead of leaking as plaintext SSE chunks.
    """

    svc = MessageService(session, current_user, get_admin_client())
    # Pre-flight authorization + provider lookup BEFORE any SSE byte is
    # written. NotFoundError → 404 JSON; ProviderNotConfiguredError → 412
    # JSON. Once we open the stream those would become useless plaintext.
    row = await svc.get_conversation_row(conversation_id)
    snapshot = await svc.resolve_provider(row, explicit_provider_id=payload.provider_id)

    async def event_stream() -> AsyncIterator[bytes]:
        try:
            async for piece in svc.stream_reply(
                conversation_id,
                payload.content,
                provider_id=snapshot.id,
                thinking=payload.thinking,
                reasoning_effort=payload.reasoning_effort,
            ):
                yield f"data: {json.dumps(piece, ensure_ascii=False)}\n\n".encode()
        finally:
            yield b"data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Disable proxy buffering so each chunk reaches the browser ASAP.
            "X-Accel-Buffering": "no",
        },
    )
