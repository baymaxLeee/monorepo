"""Conversation HTTP router (CRUD only)."""

from fastapi import APIRouter

from chat.deps import CurrentUser, DbSession
from chat.schemas.conversation import (
    Conversation,
    ConversationDetail,
    CreateConversationInput,
    UpdateConversationInput,
)
from chat.services.conversations import ConversationService

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
