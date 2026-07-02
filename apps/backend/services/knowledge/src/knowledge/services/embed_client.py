"""Embedding + rerank via an admin-configured OpenAI-compatible provider.

Kept API-only (no torch): embeddings use the provider's `/embeddings` endpoint;
rerank uses a Cohere/Jina-style `/rerank` endpoint when a rerank provider is
configured, and callers degrade to hybrid-only when it is not.
"""

from __future__ import annotations

import httpx
from knowledge.config import get_settings
from knowledge.services.admin_client import ProviderSnapshot
from openai import AsyncOpenAI

_EMBED_BATCH = 64


async def embed_texts(texts: list[str], *, provider: ProviderSnapshot) -> list[list[float]]:
    """Embed texts with the provider's embedding model, preserving input order."""
    if not texts:
        return []
    settings = get_settings()
    client = AsyncOpenAI(
        api_key=provider.api_key,
        base_url=provider.base_url,
        timeout=settings.llm_timeout_seconds,
    )
    vectors: list[list[float]] = []
    try:
        for start in range(0, len(texts), _EMBED_BATCH):
            batch = texts[start : start + _EMBED_BATCH]
            resp = await client.embeddings.create(model=provider.model, input=batch)
            ordered = sorted(resp.data, key=lambda item: item.index)
            vectors.extend(list(item.embedding) for item in ordered)
    finally:
        await client.close()
    return vectors


async def rerank(
    query: str,
    documents: list[str],
    *,
    provider: ProviderSnapshot,
    top_n: int,
) -> list[tuple[int, float]]:
    """Return (original_index, relevance_score) sorted best-first.

    Targets the common OpenAI-compatible/Cohere-style `/rerank` shape. Raises on
    transport/HTTP errors so the caller can degrade to hybrid-only.
    """
    if not documents:
        return []
    base = provider.base_url.rstrip("/")
    url = f"{base}/rerank"
    payload = {
        "model": provider.model,
        "query": query,
        "documents": documents,
        "top_n": min(top_n, len(documents)),
    }
    headers = {"Authorization": f"Bearer {provider.api_key}", "Content-Type": "application/json"}
    settings = get_settings()
    async with httpx.AsyncClient(timeout=httpx.Timeout(settings.llm_timeout_seconds, connect=5.0)) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()
    results = data.get("results") or data.get("data") or []
    ranked: list[tuple[int, float]] = []
    for item in results:
        idx = item.get("index")
        score = item.get("relevance_score", item.get("score", 0.0))
        if isinstance(idx, int):
            ranked.append((idx, float(score)))
    ranked.sort(key=lambda pair: pair[1], reverse=True)
    return ranked[:top_n]
