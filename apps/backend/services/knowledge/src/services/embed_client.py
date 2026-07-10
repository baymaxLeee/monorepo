"""Embedding + rerank via an admin-configured OpenAI-compatible provider.

Kept API-only (no torch): embeddings use the provider's `/embeddings` endpoint;
rerank uses a Cohere/Jina-style `/rerank` endpoint when a rerank provider is
configured, and callers degrade to hybrid-only when it is not.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from config import get_settings
from openai import AsyncOpenAI
from services.admin_client import ProviderSnapshot

_EMBED_BATCH = 64
_MULTIMODAL_CONCURRENCY = 5


def is_multimodal_embedding_model(model: str) -> bool:
    """Volcengine Ark multimodal embedding models (doubao-embedding-vision-*)
    use the dedicated `/embeddings/multimodal` endpoint with typed-parts input,
    NOT the standard `/embeddings` text endpoint."""
    lowered = model.lower()
    return "vision" in lowered or "multimodal" in lowered


def _extract_embedding(data: dict[str, Any]) -> list[Any] | None:
    """Ark multimodal returns `data` as a single object ({"embedding": [...]});
    the text endpoint returns a list. Handle both shapes."""
    payload = data.get("data")
    if isinstance(payload, dict):
        embedding = payload.get("embedding")
    elif isinstance(payload, list) and payload:
        first = payload[0]
        embedding = first.get("embedding") if isinstance(first, dict) else None
    else:
        embedding = None
    return embedding if isinstance(embedding, list) else None


async def embed_texts(texts: list[str], *, provider: ProviderSnapshot) -> list[list[float]]:
    """Embed texts with the provider's embedding model, preserving input order."""
    if not texts:
        return []
    if is_multimodal_embedding_model(provider.model):
        return await _embed_texts_multimodal(texts, provider=provider)
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


async def _embed_texts_multimodal(texts: list[str], *, provider: ProviderSnapshot) -> list[list[float]]:
    """Ark multimodal embedding: one structured item per request against
    `/embeddings/multimodal`. Bounded concurrency, input order preserved."""
    settings = get_settings()
    url = f"{provider.base_url.rstrip('/')}/embeddings/multimodal"
    headers = {"Authorization": f"Bearer {provider.api_key}", "Content-Type": "application/json"}
    semaphore = asyncio.Semaphore(_MULTIMODAL_CONCURRENCY)

    async with httpx.AsyncClient(timeout=httpx.Timeout(settings.llm_timeout_seconds, connect=5.0)) as client:

        async def one(text: str) -> list[float]:
            async with semaphore:
                response = await client.post(
                    url,
                    json={"model": provider.model, "input": [{"type": "text", "text": text}]},
                    headers=headers,
                )
                response.raise_for_status()
                embedding = _extract_embedding(response.json())
                if embedding is None:
                    raise ValueError("multimodal embedding response missing data.embedding")
                return [float(value) for value in embedding]

        return list(await asyncio.gather(*(one(text) for text in texts)))


async def embed_image(image_url: str, *, provider: ProviderSnapshot) -> list[float]:
    """Embed a single image body with a multimodal embedding model via
    `/embeddings/multimodal`. `image_url` is a data URI or a reachable URL.

    Returns one dense vector in the SAME space as `embed_texts` for the same
    provider, so image and caption-text chunks can share one pgvector column.
    Callers must ensure `is_multimodal_embedding_model(provider.model)`.
    """
    settings = get_settings()
    url = f"{provider.base_url.rstrip('/')}/embeddings/multimodal"
    headers = {"Authorization": f"Bearer {provider.api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(settings.llm_timeout_seconds, connect=5.0)) as client:
        response = await client.post(
            url,
            json={"model": provider.model, "input": [{"type": "image_url", "image_url": {"url": image_url}}]},
            headers=headers,
        )
        response.raise_for_status()
        embedding = _extract_embedding(response.json())
    if embedding is None:
        raise ValueError("multimodal image embedding response missing data.embedding")
    return [float(value) for value in embedding]


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
