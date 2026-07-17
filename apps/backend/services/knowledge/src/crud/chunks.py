"""Document chunk persistence (RAG index)."""

from __future__ import annotations

from collections.abc import Sequence
from secrets import token_hex
from typing import Any, cast

from config import get_settings
from models.chunk import DocumentChunkRow
from sqlalchemy import Row, delete, text
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession


def new_chunk_id() -> str:
    return token_hex(16)


async def delete_document_chunks(session: AsyncSession, document_id: str) -> int:
    result = cast(
        CursorResult[Any],
        await session.execute(delete(DocumentChunkRow).where(DocumentChunkRow.document_id == document_id)),
    )
    return result.rowcount or 0


async def insert_chunks(session: AsyncSession, rows: list[DocumentChunkRow]) -> None:
    if rows:
        session.add_all(rows)
        await session.flush()


async def dense_search(
    session: AsyncSession,
    *,
    org_id: str,
    query_vector: list[float],
    limit: int,
) -> Sequence[Row[Any]]:
    """Dense ANN search over an org's chunk embeddings (cosine distance, best first).

    Orders by `embedding::halfvec(dim) <=> q::halfvec(dim)` — the exact expression
    the v1.1.0 `ix_document_chunks_embedding_hnsw` index is built on — so the HNSW
    index is used instead of an exact sequential scan. `hnsw.ef_search` is raised
    to cover the candidate pool (`limit`) so ANN recall is not truncated below it.
    Scope is the team org so members share one knowledge base.
    """
    dim = get_settings().embedding_dim
    vec_literal = "[" + ",".join(repr(float(value)) for value in query_vector) + "]"
    await session.execute(text(f"SET LOCAL hnsw.ef_search = {max(limit * 2, 40)}"))
    stmt = text(
        f"""
        SELECT id, document_id, chunk_index, content,
               embedding::halfvec({dim}) <=> (:q)::halfvec({dim}) AS distance
        FROM document_chunks
        WHERE org_id = :org AND embedding IS NOT NULL
        ORDER BY embedding::halfvec({dim}) <=> (:q)::halfvec({dim})
        LIMIT :lim
        """
    )
    result = await session.execute(stmt, {"q": vec_literal, "org": org_id, "lim": limit})
    return result.all()


async def sparse_search(
    session: AsyncSession,
    *,
    org_id: str,
    query: str,
    limit: int,
) -> Sequence[Row[Any]]:
    """Lexical search via pg_trgm word-similarity (CJK-friendly, best first).

    Replaces the old `to_tsvector('simple', ...)` path: the `simple` FTS config
    does not segment Chinese, so sparse recall was dead for CJK queries.
    `word_similarity(query, content)` scores the query against its best-matching
    span in each chunk over character trigrams, GIN-accelerated by
    `ix_document_chunks_content_trgm`. The word-similarity threshold is lowered so
    this stays a high-recall candidate branch; RRF fusion + rerank restore precision.
    Scope is the team org so members share one knowledge base.
    """
    await session.execute(text("SET LOCAL pg_trgm.word_similarity_threshold = 0.2"))
    stmt = text(
        """
        SELECT id, document_id, chunk_index, content,
               word_similarity(:q, content) AS score
        FROM document_chunks
        WHERE org_id = :org AND (:q) <% content
        ORDER BY score DESC
        LIMIT :lim
        """
    )
    result = await session.execute(stmt, {"q": query, "org": org_id, "lim": limit})
    return result.all()
