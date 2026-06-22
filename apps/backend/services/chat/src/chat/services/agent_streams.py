"""Redis-backed event log for in-flight agent SSE runs."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Awaitable
from dataclasses import dataclass
from time import time
from typing import Any, cast
from uuid import uuid4

from kernel.errors import NotFoundError
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from chat.config import get_settings
from chat.crud import conversations as conversation_crud
from chat.deps import AuthContext


@dataclass(frozen=True)
class AgentStreamRun:
    run_id: str
    started: bool


class AgentStreamService:
    """Persist agent run events in Redis long enough for browser refresh replay."""

    def __init__(
        self,
        redis: Redis,
        session: AsyncSession,
        current_user: AuthContext,
    ) -> None:
        self._redis = redis
        self._session = session
        self._current_user = current_user
        self._settings = get_settings()

    async def ensure_conversation(self, conversation_id: str) -> None:
        row = await conversation_crud.get_conversation(
            self._session,
            conversation_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"conversation {conversation_id} not found")

    async def start_run(self, conversation_id: str) -> AgentStreamRun:
        await self.ensure_conversation(conversation_id)
        active_key = self._active_key(conversation_id)
        active_run_id = await self._live_run_id(conversation_id)
        if active_run_id:
            return AgentStreamRun(run_id=str(active_run_id), started=False)

        run_id = uuid4().hex
        await self._redis.delete(self._stream_key(conversation_id, run_id))
        await cast(
            Awaitable[int],
            self._redis.hset(
                active_key,
                mapping={
                    "run_id": run_id,
                    "status": "running",
                    "started_at_ms": self._now_ms(),
                    "last_event_at_ms": "",
                },
            ),
        )
        await self._redis.expire(active_key, self._settings.agent_event_stream_ttl_seconds)
        return AgentStreamRun(run_id=run_id, started=True)

    async def active_run_id(self, conversation_id: str) -> str | None:
        await self.ensure_conversation(conversation_id)
        return await self._live_run_id(conversation_id)

    async def append_event(
        self,
        *,
        conversation_id: str,
        run_id: str,
        event: dict[str, Any],
    ) -> None:
        stream_key = self._stream_key(conversation_id, run_id)
        await self._redis.xadd(stream_key, {"event": json.dumps(event, ensure_ascii=False)})
        await cast(
            Awaitable[int],
            self._redis.hset(
                self._active_key(conversation_id),
                mapping={"last_event_at_ms": self._now_ms()},
            ),
        )
        await self._redis.expire(stream_key, self._settings.agent_event_stream_ttl_seconds)
        await self._redis.expire(
            self._active_key(conversation_id),
            self._settings.agent_event_stream_ttl_seconds,
        )

    async def finish_run(self, *, conversation_id: str, run_id: str) -> None:
        active_key = self._active_key(conversation_id)
        active_run_id = await cast(Awaitable[str | None], self._redis.hget(active_key, "run_id"))
        if active_run_id == run_id:
            await self._redis.delete(active_key)

    async def stream_events(
        self,
        *,
        conversation_id: str,
        run_id: str,
    ) -> AsyncIterator[dict[str, Any]]:
        stream_key = self._stream_key(conversation_id, run_id)
        last_id = "0-0"
        while True:
            response = await self._redis.xread(
                {stream_key: last_id},
                count=50,
                block=self._settings.agent_event_stream_block_ms,
            )
            if not response:
                if not await self._is_active(conversation_id, run_id):
                    response = await self._redis.xread({stream_key: last_id}, count=50)
                    if not response:
                        break
                else:
                    continue

            should_stop = False
            for _key, entries in response:
                for entry_id, fields in entries:
                    last_id = entry_id
                    raw_event = fields.get("event")
                    if not raw_event:
                        continue
                    event = json.loads(raw_event)
                    yield event
                    if event.get("type") in {"done", "error"} or (
                        event.get("type") == "message" and event.get("status") in {"completed", "failed"}
                    ):
                        should_stop = True
                        break
                if should_stop:
                    break
            if should_stop:
                return

    async def _is_active(self, conversation_id: str, run_id: str) -> bool:
        active_run_id = await self._live_run_id(conversation_id)
        return active_run_id == run_id

    async def _live_run_id(self, conversation_id: str) -> str | None:
        active_key = self._active_key(conversation_id)
        active = await cast(Awaitable[dict[str, str]], self._redis.hgetall(active_key))
        run_id = active.get("run_id")
        if not run_id:
            return None

        stream_key = self._stream_key(conversation_id, run_id)
        stream_len = await self._redis.xlen(stream_key)
        if stream_len > 0:
            return str(run_id)

        started_at = self._parse_ms(active.get("started_at_ms"))
        if started_at is None or self._now_ms() - started_at > self._settings.agent_event_stream_stale_seconds * 1000:
            await self._redis.delete(active_key)
            return None
        return str(run_id)

    @staticmethod
    def _now_ms() -> int:
        return int(time() * 1000)

    @staticmethod
    def _parse_ms(raw: str | None) -> int | None:
        if not raw:
            return None
        try:
            return int(raw)
        except ValueError:
            return None

    @staticmethod
    def _active_key(conversation_id: str) -> str:
        return f"chat:agent-runs:{conversation_id}:active"

    @staticmethod
    def _stream_key(conversation_id: str, run_id: str) -> str:
        return f"chat:agent-runs:{conversation_id}:{run_id}:events"
