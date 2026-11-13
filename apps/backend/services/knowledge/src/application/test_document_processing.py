import pytest
from infrastructure.persistence.models.document import DocumentRow

from application import document_processing


def document(**values: str) -> DocumentRow:
    return DocumentRow(
        id="document",
        user_id="user",
        kind="source",
        title="Document",
        filename="document.md",
        mime_type="text/markdown",
        **values,
    )


@pytest.mark.parametrize(
    ("ingest_status", "index_status", "expected"),
    [
        ("received", "pending", True),
        ("failed", "pending", True),
        ("ready", "pending", True),
        ("ready", "failed", True),
        ("ready", "indexed", False),
    ],
)
def test_processing_need_is_derived_from_document_state(ingest_status: str, index_status: str, expected: bool) -> None:
    row = document(ingest_status=ingest_status, index_status=index_status)
    assert document_processing.needs_processing(row) is expected


@pytest.mark.parametrize("terminal", ["deleted", "not-source", "failed"])
async def test_terminal_conversion_skips_index(monkeypatch: pytest.MonkeyPatch, terminal: str) -> None:
    indexed: list[str] = []

    async def convert(document_id: str, *, provider_id: str | None = None) -> str:
        assert document_id == "document"
        assert provider_id == "provider"
        return terminal

    async def index(document_id: str) -> str:
        indexed.append(document_id)
        return "indexed"

    monkeypatch.setattr(document_processing, "convert_document", convert)
    monkeypatch.setattr(document_processing, "index_document_by_id", index)

    result = await document_processing.process_document("document", provider_id="provider")

    assert result.conversion == terminal
    assert result.indexing == "skipped"
    assert indexed == []


async def test_successful_conversion_is_indexed(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def convert(document_id: str, *, provider_id: str | None = None) -> str:
        calls.append(f"convert:{document_id}:{provider_id}")
        return "ready"

    async def index(document_id: str) -> str:
        calls.append(f"index:{document_id}")
        return "indexed"

    monkeypatch.setattr(document_processing, "convert_document", convert)
    monkeypatch.setattr(document_processing, "index_document_by_id", index)

    result = await document_processing.process_document("document", provider_id="provider")

    assert result.conversion == "ready"
    assert result.indexing == "indexed"
    assert calls == ["convert:document:provider", "index:document"]
