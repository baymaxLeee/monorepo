from types import SimpleNamespace
from typing import Any

import pytest

from application import retrieval
from application.admin_client import ProviderSnapshot


def _provider(model: str) -> ProviderSnapshot:
    return ProviderSnapshot(
        id=model,
        user_id="user",
        name=model,
        model=model,
        base_url="https://models.invalid/v1",
        api_key="secret",
        extra_body={},
        is_default=True,
        is_enabled=True,
    )


@pytest.mark.asyncio
async def test_retrieve_is_model_safe_and_reranks_contextual_content(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, Any] = {}

    class Admin:
        async def get_provider_by_kind(self, **kwargs: Any) -> ProviderSnapshot:
            return _provider("embed-v2" if kwargs["kind"] == "embedding" else "rerank-v1")

    async def embed_texts(texts: list[str], **_kwargs: Any) -> list[list[float]]:
        calls["embedded"] = texts
        return [[0.1, 0.2]]

    async def dense_search(_session: Any, **kwargs: Any) -> list[Any]:
        calls["dense"] = kwargs
        return [
            SimpleNamespace(
                id="chunk-a",
                document_id="doc-a",
                chunk_index=0,
                content="raw alpha",
                contextualized_content="Project Atlas runbook. raw alpha",
                distance=0.1,
            )
        ]

    async def sparse_search(_session: Any, **kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                id="chunk-b",
                document_id="doc-b",
                chunk_index=4,
                content="raw beta",
                contextualized_content="Project Atlas rollback. raw beta",
                score=0.8,
            )
        ]

    async def rerank(
        query: str, documents: list[str], **_kwargs: Any
    ) -> list[tuple[int, float]]:
        calls["rerank"] = (query, documents)
        return [(1, 0.91), (0, 0.63)]

    async def get_documents_meta(_session: Any, _ids: list[str]) -> dict[str, tuple[str, str, str]]:
        return {
            "doc-a": ("Alpha", "alpha.md", "text/markdown"),
            "doc-b": ("Beta", "beta.md", "text/markdown"),
        }

    monkeypatch.setattr(
        retrieval,
        "get_settings",
        lambda: SimpleNamespace(retrieval_top_k=2, retrieval_candidate_k=10, rrf_k=60, rerank_enabled=True),
    )
    monkeypatch.setattr(retrieval, "get_admin_client", lambda: Admin())
    monkeypatch.setattr(retrieval, "embed_texts", embed_texts)
    monkeypatch.setattr(retrieval.chunk_crud, "dense_search", dense_search)
    monkeypatch.setattr(retrieval.chunk_crud, "sparse_search", sparse_search)
    monkeypatch.setattr(retrieval, "rerank", rerank)
    monkeypatch.setattr(retrieval.document_crud, "get_documents_meta", get_documents_meta)

    result = await retrieval.retrieve(
        SimpleNamespace(),  # type: ignore[arg-type]
        workspace_id="workspace",
        tenant_id="tenant",
        query="Atlas rollback",
    )

    assert calls["embedded"] == ["Atlas rollback"]
    assert calls["dense"]["embed_model"] == "embed-v2"
    assert calls["rerank"] == (
        "Atlas rollback",
        ["Project Atlas runbook. raw alpha", "Project Atlas rollback. raw beta"],
    )
    assert [(chunk.document_id, chunk.content, chunk.score) for chunk in result.chunks] == [
        ("doc-b", "raw beta", 0.91),
        ("doc-a", "raw alpha", 0.63),
    ]


@pytest.mark.asyncio
async def test_invalid_or_partial_rerank_results_preserve_candidate_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Admin:
        async def get_provider_by_kind(self, **kwargs: Any) -> ProviderSnapshot:
            return _provider(kwargs["kind"])

    async def embed_texts(_texts: list[str], **_kwargs: Any) -> list[list[float]]:
        return [[0.1]]

    async def dense_search(_session: Any, **_kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                id="a", document_id="doc-a", chunk_index=0, content="a", contextualized_content=None, distance=0.1
            ),
            SimpleNamespace(
                id="b", document_id="doc-b", chunk_index=0, content="b", contextualized_content=None, distance=0.2
            ),
        ]

    async def sparse_search(_session: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def rerank(*_args: Any, **_kwargs: Any) -> list[tuple[int, float]]:
        return [(99, 1.0), (1, 0.8), (1, 0.7)]

    async def get_documents_meta(_session: Any, ids: list[str]) -> dict[str, tuple[str, str, str]]:
        return {document_id: (document_id, f"{document_id}.md", "text/markdown") for document_id in ids}

    monkeypatch.setattr(
        retrieval,
        "get_settings",
        lambda: SimpleNamespace(retrieval_top_k=2, retrieval_candidate_k=10, rrf_k=60, rerank_enabled=True),
    )
    monkeypatch.setattr(retrieval, "get_admin_client", lambda: Admin())
    monkeypatch.setattr(retrieval, "embed_texts", embed_texts)
    monkeypatch.setattr(retrieval.chunk_crud, "dense_search", dense_search)
    monkeypatch.setattr(retrieval.chunk_crud, "sparse_search", sparse_search)
    monkeypatch.setattr(retrieval, "rerank", rerank)
    monkeypatch.setattr(retrieval.document_crud, "get_documents_meta", get_documents_meta)

    result = await retrieval.retrieve(
        SimpleNamespace(),  # type: ignore[arg-type]
        workspace_id="workspace",
        tenant_id="tenant",
        query="q",
    )

    assert [chunk.document_id for chunk in result.chunks] == ["doc-b", "doc-a"]
    assert result.chunks[0].score == 0.8
