"""Contextual Retrieval (Anthropic): prepend a short, document-aware context to
each chunk before embedding/indexing.

Highest-ROI accuracy lever in 2026 RAG. Best-effort: any per-chunk failure
falls back to the raw chunk (returns None for that chunk) so indexing never
fails because of context generation.
"""

from __future__ import annotations

import asyncio

from config import get_settings
from openai import AsyncOpenAI
from services.admin_client import ProviderSnapshot

_CONCURRENCY = 5
_DOC_BUDGET_CHARS = 8000

_PROMPT = (
    "You situate a chunk within its source document to improve search retrieval.\n"
    "<document>\n{document}\n</document>\n"
    "<chunk>\n{chunk}\n</chunk>\n"
    "Give a short (50-100 token) context that situates this chunk within the "
    "document (what section/topic it belongs to, key entities). Answer with the "
    "context only, no preamble."
)


async def contextualize_chunks(
    chunks: list[str],
    *,
    document_text: str,
    provider: ProviderSnapshot,
) -> list[str | None]:
    """Return a per-chunk context string (or None on failure), input-aligned."""
    if not chunks:
        return []
    settings = get_settings()
    document = document_text[:_DOC_BUDGET_CHARS]
    client = AsyncOpenAI(
        api_key=provider.api_key,
        base_url=provider.base_url,
        timeout=settings.llm_timeout_seconds,
    )
    semaphore = asyncio.Semaphore(_CONCURRENCY)

    async def one(chunk: str) -> str | None:
        async with semaphore:
            try:
                resp = await client.chat.completions.create(
                    model=provider.model,
                    messages=[{"role": "user", "content": _PROMPT.format(document=document, chunk=chunk)}],
                    max_tokens=settings.contextual_context_max_tokens,
                )
            except Exception:
                return None
            text = (resp.choices[0].message.content or "").strip() if resp.choices else ""
            return text or None

    try:
        return await asyncio.gather(*(one(chunk) for chunk in chunks))
    finally:
        await client.close()
