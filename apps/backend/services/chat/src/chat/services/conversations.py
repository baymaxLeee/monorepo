"""Conversation business service."""

# `async def list(self)` shadows builtin `list` in this class. Delay
# annotation evaluation so `foo: list[str]` annotations later in the class
# body don't blow up at import time.
from __future__ import annotations

from datetime import UTC, datetime

from kernel.errors import NotFoundError
from sqlalchemy.ext.asyncio import AsyncSession

from chat.crud import conversations as conversation_crud
from chat.crud import messages as message_crud
from chat.deps import AuthContext
from chat.models.conversation import ConversationRow
from chat.models.message import MessageRow
from chat.schemas.conversation import (
    Conversation,
    ConversationDetail,
    CreateConversationInput,
    Message,
    UpdateConversationInput,
)


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def conversation_to_schema(row: ConversationRow) -> Conversation:
    return Conversation(
        id=row.id,
        user_id=row.user_id,
        title=row.title,
        model=row.model,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


def message_to_schema(row: MessageRow) -> Message:
    return Message(
        id=row.id,
        conversation_id=row.conversation_id,
        role=row.role,  # type: ignore[arg-type]
        content=row.content,
        status=row.status,  # type: ignore[arg-type]
        created_at=_iso(row.created_at),
    )


class ConversationService:
    def __init__(
        self,
        session: AsyncSession,
        current_user: AuthContext,
        default_model: str = "",
    ) -> None:
        self._session = session
        self._current_user = current_user
        self._default_model = default_model

    async def list(self) -> list[Conversation]:
        rows = await conversation_crud.list_conversations(
            self._session,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        return [conversation_to_schema(row) for row in rows]

    async def get(self, conversation_id: str) -> ConversationDetail:
        row = await self._get_row(conversation_id)
        message_rows = await message_crud.list_messages(self._session, row.id)
        base = conversation_to_schema(row)
        return ConversationDetail(
            **base.model_dump(),
            messages=[message_to_schema(m) for m in message_rows],
        )

    async def create(self, payload: CreateConversationInput) -> Conversation:
        row = await conversation_crud.create_conversation(
            self._session,
            title=payload.title,
            model=self._default_model,
            user_id=self._current_user.user_id,
        )
        return conversation_to_schema(row)

    async def update(
        self,
        conversation_id: str,
        payload: UpdateConversationInput,
    ) -> Conversation:
        row = await self._get_row(conversation_id)
        values = payload.model_dump(exclude_unset=True, exclude_none=True)
        if not values:
            return conversation_to_schema(row)
        return conversation_to_schema(await conversation_crud.update_conversation(self._session, row, values))

    async def delete(self, conversation_id: str) -> None:
        row = await self._get_row(conversation_id)
        await conversation_crud.delete_conversation(self._session, row)

    async def _get_row(self, conversation_id: str) -> ConversationRow:
        row = await conversation_crud.get_conversation(
            self._session,
            conversation_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"conversation {conversation_id} not found")
        return row
