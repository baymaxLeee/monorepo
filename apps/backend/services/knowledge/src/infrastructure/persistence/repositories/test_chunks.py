from typing import Any

import pytest

from infrastructure.persistence.repositories import chunks


class _Result:
    def all(self) -> list[Any]:
        return []


class _Session:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any] | None]] = []

    async def execute(self, statement: Any, params: dict[str, Any] | None = None) -> _Result:
        self.calls.append((str(statement), params))
        return _Result()


@pytest.mark.asyncio
async def test_dense_search_filters_the_active_embedding_space_and_expands_filtered_ann() -> None:
    session = _Session()

    await chunks.dense_search(
        session,  # type: ignore[arg-type]
        workspace_id="workspace",
        tenant_id="tenant",
        embed_model="embed-v2",
        query_vector=[0.1, 0.2],
        limit=20,
    )

    assert session.calls[0][0] == "SET LOCAL hnsw.iterative_scan = strict_order"
    query, params = session.calls[-1]
    assert "embed_model = :embed_model" in query
    assert "contextualized_content" in query
    assert params is not None
    assert params["embed_model"] == "embed-v2"


@pytest.mark.asyncio
async def test_sparse_search_considers_raw_and_contextualized_text() -> None:
    session = _Session()

    await chunks.sparse_search(
        session,  # type: ignore[arg-type]
        workspace_id="workspace",
        tenant_id="tenant",
        query="Atlas",
        limit=20,
    )

    query, _params = session.calls[-1]
    assert "word_similarity(:q, content)" in query
    assert "word_similarity(:q, contextualized_content)" in query
    assert "(:q) <% contextualized_content" in query
