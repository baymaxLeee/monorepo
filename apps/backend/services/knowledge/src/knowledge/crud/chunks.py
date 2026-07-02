"""Document chunk persistence (RAG index)."""

from __future__ import annotations

from collections.abc import Sequence
from secrets import token_hex
from typing import Any, cast

from knowledge.models.chunk import DocumentChunkRow
from sqlalchemy import Row, delete, func, select, text
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


async def count_document_chunks(session: AsyncSession, document_id: str) -> int:
    result = await session.scalar(
        select(func.count()).select_from(DocumentChunkRow).where(
            DocumentChunkRow.document_id == document_id
        )
    )
    return int(result or 0)


async def dense_search(
    session: AsyncSession,
    *,
    user_id: str,
    query_vector: list[float],
    limit: int,
) -> Sequence[Row[Any]]:
    """Cosine-distance ANN search over a user's chunk embeddings (best first)."""
    distance = DocumentChunkRow.embedding.cosine_distance(query_vector)
    stmt = (
        select(
            DocumentChunkRow.id,
            DocumentChunkRow.document_id,
            DocumentChunkRow.chunk_index,
            DocumentChunkRow.content,
            distance.label("distance"),
        )
        .where(DocumentChunkRow.user_id == user_id, DocumentChunkRow.embedding.is_not(None))
        .order_by(distance)
        .limit(limit)
    )
    result = await session.execute(stmt)
    return result.all()


async def sparse_search(
    session: AsyncSession,
    *,
    user_id: str,
    query: str,
    limit: int,
) -> Sequence[Row[Any]]:
    """BM25-style full-text search over the DB-maintained tsvector (best first)."""
    stmt = text(
        """
        SELECT id, document_id, chunk_index, content,
               ts_rank_cd(tsv, websearch_to_tsquery('simple', :q)) AS score
        FROM document_chunks
        WHERE user_id = :uid AND tsv @@ websearch_to_tsquery('simple', :q)
        ORDER BY score DESC
        LIMIT :lim
        """
    )
    result = await session.execute(stmt, {"q": query, "uid": user_id, "lim": limit})
    return result.all()
