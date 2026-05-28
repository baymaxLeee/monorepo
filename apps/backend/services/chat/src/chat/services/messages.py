"""Message orchestration: persist user → stream LLM → persist assistant."""

from __future__ import annotations

from collections.abc import AsyncIterator

from kernel.errors import NotFoundError
from sqlalchemy.ext.asyncio import AsyncSession

from chat.crud import conversations as conversation_crud
from chat.crud import messages as message_crud
from chat.deps import AuthContext
from chat.models.conversation import ConversationRow
from chat.schemas.conversation import ReasoningEffort
from chat.services.llm import LLMClient


class MessageService:
    def __init__(
        self,
        session: AsyncSession,
        current_user: AuthContext,
        llm: LLMClient,
    ) -> None:
        self._session = session
        self._current_user = current_user
        self._llm = llm

    async def stream_reply(
        self,
        conversation_id: str,
        user_content: str,
        *,
        thinking: bool | None = None,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> AsyncIterator[str]:
        row = await self._get_conversation(conversation_id)

        await message_crud.create_message(
            self._session,
            conversation_id=row.id,
            role="user",
            content=user_content,
            status="ok",
        )

        history_rows = await message_crud.list_messages(self._session, row.id)
        history: list[dict[str, str]] = [
            {"role": m.role, "content": m.content} for m in history_rows if m.status != "failed"
        ]

        # When the model column is empty (legacy / pre-LLM rows), stamp the
        # currently configured model so the UI shows where the reply came from.
        if not row.model and self._llm.model:
            row.model = self._llm.model

        buffer: list[str] = []
        try:
            async for piece in self._llm.stream_chat(
                history,
                thinking=thinking,
                reasoning_effort=reasoning_effort,
            ):
                buffer.append(piece)
                yield piece
        except Exception as exc:
            await message_crud.create_message(
                self._session,
                conversation_id=row.id,
                role="assistant",
                content="".join(buffer),
                status="failed",
            )
            await conversation_crud.touch_conversation(self._session, row)
            yield f"\n\n[chat] upstream LLM error: {exc!s}"
            return

        await message_crud.create_message(
            self._session,
            conversation_id=row.id,
            role="assistant",
            content="".join(buffer),
            status="ok",
        )
        await conversation_crud.touch_conversation(self._session, row)

    async def _get_conversation(self, conversation_id: str) -> ConversationRow:
        row = await conversation_crud.get_conversation(
            self._session,
            conversation_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"conversation {conversation_id} not found")
        return row
