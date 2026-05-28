"""LLM client.

Uses an OpenAI-compatible HTTP endpoint (any provider that exposes
`/v1/chat/completions` works — OpenAI, DeepSeek, Doubao, Moonshot, vLLM, ...).

When `OPENAI_API_KEY` is empty we fall back to a deterministic echo mock so
the demo always runs without external dependencies.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from typing import Any, cast

from openai import AsyncOpenAI, AsyncStream
from openai.types.chat import ChatCompletionChunk

from chat.config import Settings
from chat.schemas.conversation import ReasoningEffort


class LLMClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: AsyncOpenAI | None = None
        if settings.llm_enabled:
            self._client = AsyncOpenAI(
                api_key=settings.openai_api_key,
                base_url=settings.openai_base_url,
                timeout=settings.llm_timeout_seconds,
            )

    @property
    def model(self) -> str:
        return self._settings.openai_model

    async def stream_chat(
        self,
        history: Sequence[dict[str, str]],
        *,
        thinking: bool | None = None,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> AsyncIterator[str]:
        if self._client is None:
            async for chunk in _mock_stream(history):
                yield chunk
            return

        # DeepSeek V4 (and Anthropic-style backends) accept two vendor
        # extensions under the OpenAI-compatible payload. We forward them
        # via `extra_body` so callers that don't pass them get vanilla
        # chat-completions behavior.
        extra_body: dict[str, Any] = {}
        if thinking is not None:
            extra_body["thinking"] = {"type": "enabled" if thinking else "disabled"}
        if reasoning_effort is not None:
            extra_body["reasoning_effort"] = reasoning_effort

        stream = cast(
            AsyncStream[ChatCompletionChunk],
            await self._client.chat.completions.create(
                model=self._settings.openai_model,
                messages=list(history),  # type: ignore[arg-type]
                stream=True,
                extra_body=extra_body or None,
            ),
        )
        async for event in stream:
            if not event.choices:
                continue
            delta = event.choices[0].delta
            piece = getattr(delta, "content", None)
            if piece:
                yield piece


async def _mock_stream(history: Sequence[dict[str, str]]) -> AsyncIterator[str]:
    """Deterministic echo response for keyless local runs.

    Streams a friendly preface followed by the last user message split into
    short chunks so the SSE UX matches a real upstream.
    """
    last_user = next(
        (m["content"] for m in reversed(history) if m.get("role") == "user"),
        "",
    )
    prefix = "(本地 mock LLM 回声响应, 没有配置 OPENAI_API_KEY) 你说: "
    chunks: list[str] = [prefix]
    for i in range(0, len(last_user), 8):
        chunks.append(last_user[i : i + 8])
    if not last_user:
        chunks.append("我在听。")
    for piece in chunks:
        await asyncio.sleep(0.04)
        yield piece
