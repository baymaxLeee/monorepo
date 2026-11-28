from application.contextual import _DOC_BUDGET_CHARS, _document_view


def test_document_view_keeps_front_matter_and_the_late_chunk_context() -> None:
    document = "# Atlas Runbook\nowner: platform\n" + ("early material\n" * 900) + "ROLLBACK-CHECKLIST\nlate fact"
    chunk = "ROLLBACK-CHECKLIST\nlate fact"

    view = _document_view(document, chunk)

    assert len(view) <= _DOC_BUDGET_CHARS
    assert "# Atlas Runbook" in view
    assert chunk in view
    assert "middle omitted" in view


def test_document_view_keeps_short_documents_unchanged() -> None:
    document = "# Short\nFact"

    assert _document_view(document, "Fact") == document
