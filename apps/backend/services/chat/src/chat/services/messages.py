"""Message orchestration: persist user → stream LLM → persist assistant."""

from __future__ import annotations

from collections.abc import AsyncIterator

from kernel.errors import NotFoundError
from sqlalchemy.ext.asyncio import AsyncSession

from chat.config import get_settings
from chat.crud import conversations as conversation_crud
from chat.crud import messages as message_crud
from chat.deps import AuthContext
from chat.models.conversation import ConversationRow
from chat.schemas.conversation import ReasoningEffort
from chat.services.admin_client import AdminClient, ProviderSnapshot
from chat.services.llm import LLMClient


class MessageService:
    def __init__(
        self,
        session: AsyncSession,
        current_user: AuthContext,
        admin: AdminClient,
    ) -> None:
        self._session = session
        self._current_user = current_user
        self._admin = admin

    async def resolve_provider(
        self,
        conversation: ConversationRow,
        *,
        explicit_provider_id: str | None,
    ) -> ProviderSnapshot:
        """Resolve the provider snapshot for a reply.

        Precedence (first wins):
          1. `explicit_provider_id` from the request body
          2. The conversation's stored `provider_id` (last used)
          3. The user's default provider

        Raises ProviderNotConfiguredError if none resolve.
        """

        provider_id = explicit_provider_id or (conversation.provider_id or None)
        return await self._admin.get_provider(
            user_id=self._current_user.user_id,
            provider_id=provider_id,
        )

    async def stream_reply(
        self,
        conversation_id: str,
        user_content: str,
        *,
        provider_id: str | None = None,
        thinking: bool | None = None,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> AsyncIterator[str]:
        row = await self.get_conversation_row(conversation_id)

        # Resolve provider BEFORE writing the user message so we don't end
        # up with a dangling user turn whenever the provider lookup fails.
        snapshot = await self.resolve_provider(row, explicit_provider_id=provider_id)

        # Persist the pinning so subsequent messages keep using the same
        # provider/model even when the request omits `provider_id`.
        if row.provider_id != snapshot.id or row.model != snapshot.model:
            row.provider_id = snapshot.id
            row.model = snapshot.model

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

        llm = LLMClient.from_provider(
            snapshot,
            timeout_seconds=get_settings().llm_timeout_seconds,
        )
        buffer: list[str] = []
        try:
            async for piece in llm.stream_chat(
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
        finally:
            await llm.aclose()

        await message_crud.create_message(
            self._session,
            conversation_id=row.id,
            role="assistant",
            content="".join(buffer),
            status="ok",
        )
        await conversation_crud.touch_conversation(self._session, row)

    async def get_conversation_row(self, conversation_id: str) -> ConversationRow:
        """Load the conversation, enforcing per-user ownership.

        Exposed publicly so the SSE router can pre-flight authorization
        BEFORE response headers ship — once `text/event-stream` headers are
        sent we lose the ability to return a proper 4xx body.
        """

        row = await conversation_crud.get_conversation(
            self._session,
            conversation_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"conversation {conversation_id} not found")
        return row
