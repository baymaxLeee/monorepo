"""Hybrid RAG retrieval: dense (pgvector) + sparse (BM25/tsvector) fused with
Reciprocal Rank Fusion, then an optional cross-encoder rerank.

Degrades gracefully: no embedding provider -> sparse-only; no rerank provider or
a rerank error -> RRF order. All results are scoped to the requesting user
(ACL), and every chunk carries its source document for citation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from knowledge.config import get_settings
from knowledge.crud import chunks as chunk_crud
from knowledge.crud import documents as document_crud
from knowledge.schemas.retrieval import RetrievedChunk, RetrieveResult
from knowledge.services.admin_client import ProviderNotConfiguredError, get_admin_client
from knowledge.services.embed_client import embed_texts, rerank
from sqlalchemy.ext.asyncio import AsyncSession

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
    user_id: str,
    query: str,
    top_k: int | None = None,
) -> RetrieveResult:
    settings = get_settings()
    top_k = top_k or settings.retrieval_top_k
    candidate_k = settings.retrieval_candidate_k
    note: str | None = None

    dense: list[_Candidate] = []
    try:
        embed_provider = await get_admin_client().get_provider_by_kind(user_id=user_id, kind="embedding")
        query_vector = (await embed_texts([query], provider=embed_provider))[0]
        dense_rows = await chunk_crud.dense_search(
            session, user_id=user_id, query_vector=query_vector, limit=candidate_k
        )
        dense = [
            _Candidate(row.id, row.document_id, row.chunk_index, row.content, 1.0 - float(row.distance))
            for row in dense_rows
        ]
    except ProviderNotConfiguredError:
        note = "no embedding provider configured; sparse-only retrieval"
    except Exception as exc:  # dense is best-effort; fall back to sparse
        logger.warning("dense retrieval failed: %s", exc)
        note = "dense retrieval unavailable; sparse-only retrieval"

    sparse_rows = await chunk_crud.sparse_search(session, user_id=user_id, query=query, limit=candidate_k)
    sparse = [
        _Candidate(row.id, row.document_id, row.chunk_index, row.content, float(row.score))
        for row in sparse_rows
    ]

    fused = _rrf_fuse(dense, sparse, k=settings.rrf_k)[:candidate_k]
    if not fused:
        return RetrieveResult(query=query, chunks=[], note=note or "no matching content")

    ordered = fused
    if settings.rerank_enabled and len(fused) > 1:
        try:
            rerank_provider = await get_admin_client().get_provider_by_kind(user_id=user_id, kind="rerank")
            ranking = await rerank(
                query, [c.content for c in fused], provider=rerank_provider, top_n=top_k
            )
            if ranking:
                ordered = [fused[index] for index, _ in ranking]
        except ProviderNotConfiguredError:
            pass  # no rerank provider: keep RRF order
        except Exception as exc:  # rerank is best-effort
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
