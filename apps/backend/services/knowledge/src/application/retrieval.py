"""Hybrid RAG retrieval: dense (pgvector) + sparse (BM25/tsvector) fused with
Reciprocal Rank Fusion, then an optional cross-encoder rerank.

Degrades gracefully: no embedding provider -> sparse-only; no rerank provider or
a rerank error -> RRF order. All results are scoped to the caller's team org
(ACL), and every chunk carries its source document for citation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from bootstrap.config import get_settings
from infrastructure.persistence.repositories import chunks as chunk_crud
from infrastructure.persistence.repositories import documents as document_crud
from sqlalchemy.ext.asyncio import AsyncSession

from application.admin_client import ProviderNotConfiguredError, get_admin_client
from application.contracts.retrieval import RetrievedChunk, RetrieveResult
from application.embed_client import embed_texts, rerank

logger = logging.getLogger("knowledge.retrieval")


@dataclass
class _Candidate:
    chunk_id: str
    document_id: str
    chunk_index: int
    content: str
    score: float


def _rrf_fuse(
    dense: list[_Candidate],
    sparse: list[_Candidate],
    *,
    k: int,
) -> list[_Candidate]:
    """Reciprocal Rank Fusion (k=60 default). Rank-based, no score calibration."""
    scores: dict[str, float] = {}
    by_id: dict[str, _Candidate] = {}
    for ranked in (dense, sparse):
        for rank, candidate in enumerate(ranked):
            scores[candidate.chunk_id] = scores.get(candidate.chunk_id, 0.0) + 1.0 / (k + rank + 1)
            by_id.setdefault(candidate.chunk_id, candidate)
    fused = [
        _Candidate(
            chunk_id=cid,
            document_id=by_id[cid].document_id,
            chunk_index=by_id[cid].chunk_index,
            content=by_id[cid].content,
            score=score,
        )
        for cid, score in scores.items()
    ]
    fused.sort(key=lambda item: item.score, reverse=True)
    return fused


async def retrieve(
    session: AsyncSession,
    *,
    org_id: str,
    query: str,
    top_k: int | None = None,
) -> RetrieveResult:
    """Hybrid retrieval over the team org's knowledge base.

    Both the chunk ACL scope and the embedding/rerank provider are resolved by
    ``org_id`` — model providers are team-shared, so the whole team retrieves
    against the same embedding space. If the team has no embedding provider,
    dense degrades to sparse-only.
    """
    settings = get_settings()
    top_k = top_k or settings.retrieval_top_k
    candidate_k = settings.retrieval_candidate_k
    note: str | None = None

    dense: list[_Candidate] = []
    try:
        embed_provider = await get_admin_client().get_provider_by_kind(org_id=org_id, kind="embedding")
        query_vector = (await embed_texts([query], provider=embed_provider))[0]
        dense_rows = await chunk_crud.dense_search(session, org_id=org_id, query_vector=query_vector, limit=candidate_k)
        dense = [
            _Candidate(row.id, row.document_id, row.chunk_index, row.content, 1.0 - float(row.distance))
            for row in dense_rows
        ]
    except ProviderNotConfiguredError:
        note = "no embedding provider configured; sparse-only retrieval"
    except Exception as exc:
        logger.warning("dense retrieval failed: %s", exc)
        note = "dense retrieval unavailable; sparse-only retrieval"

    sparse_rows = await chunk_crud.sparse_search(session, org_id=org_id, query=query, limit=candidate_k)
    sparse = [
        _Candidate(row.id, row.document_id, row.chunk_index, row.content, float(row.score)) for row in sparse_rows
    ]

    fused = _rrf_fuse(dense, sparse, k=settings.rrf_k)[:candidate_k]
    if not fused:
        return RetrieveResult(query=query, chunks=[], note=note or "no matching content")

    ordered = fused
    if settings.rerank_enabled and len(fused) > 1:
        try:
            rerank_provider = await get_admin_client().get_provider_by_kind(org_id=org_id, kind="rerank")
            ranking = await rerank(query, [c.content for c in fused], provider=rerank_provider, top_n=top_k)
            if ranking:
                ordered = [fused[index] for index, _ in ranking]
        except ProviderNotConfiguredError:
            pass
        except Exception as exc:
            logger.warning("rerank failed; using RRF order: %s", exc)

    top = ordered[:top_k]
    meta = await document_crud.get_documents_meta(session, [c.document_id for c in top])
    chunks = [
        RetrievedChunk(
            document_id=c.document_id,
            chunk_index=c.chunk_index,
            content=c.content,
            score=round(c.score, 6),
            title=meta.get(c.document_id, ("", ""))[0],
            filename=meta.get(c.document_id, ("", ""))[1],
        )
        for c in top
    ]
    return RetrieveResult(query=query, chunks=chunks, note=note)
