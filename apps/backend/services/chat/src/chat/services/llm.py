"""LLM client (OpenAI-compatible endpoint).

A `LLMClient` is bound to one `ProviderSnapshot` for the lifetime of a single
reply stream. Callers build it via `LLMClient.from_provider(snapshot, …)` —
there is intentionally NO env-driven fallback because credentials live in
admin only (see services/admin_client.py).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from typing import Any, cast

from openai import AsyncOpenAI, AsyncStream
from openai.types.chat import ChatCompletionChunk

from chat.schemas.conversation import ReasoningEffort
from chat.services.admin_client import ProviderSnapshot


class LLMClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        provider_extra_body: dict[str, Any] | None = None,
        timeout_seconds: float = 60.0,
    ) -> None:
        self._model = model
        self._provider_extra_body = provider_extra_body or {}
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout_seconds,
        )

    @classmethod
    def from_provider(
        cls,
        snapshot: ProviderSnapshot,
        *,
        timeout_seconds: float = 60.0,
    ) -> LLMClient:
        return cls(
            api_key=snapshot.api_key,
            base_url=snapshot.base_url,
            model=snapshot.model,
            provider_extra_body=snapshot.extra_body,
            timeout_seconds=timeout_seconds,
        )

    @property
    def model(self) -> str:
        return self._model

    async def aclose(self) -> None:
        await self._client.close()

    async def stream_chat(
        self,
        history: Sequence[dict[str, str]],
        *,
        thinking: bool | None = None,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> AsyncIterator[str]:
        # extra_body precedence: provider-level defaults (admin-configured)
        # then per-request overrides. Per-request wins on conflicts so the
        # admin can ship sane defaults while the UI still lets the user
        # toggle thinking on/off per message.
        extra_body: dict[str, Any] = dict(self._provider_extra_body)
        if thinking is not None:
            extra_body["thinking"] = {"type": "enabled" if thinking else "disabled"}
        if reasoning_effort is not None:
            extra_body["reasoning_effort"] = reasoning_effort

        stream = cast(
            AsyncStream[ChatCompletionChunk],
            await self._client.chat.completions.create(
                model=self._model,
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
