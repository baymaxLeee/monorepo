from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock

import pytest
from application import document_operations
from knowledge_kernel.errors import NotFoundError


async def test_workspace_source_resolver_uses_tenant_and_workspace_acl(monkeypatch):
    row = SimpleNamespace(id="document")
    lookup = AsyncMock(return_value=row)
    monkeypatch.setattr(document_operations.document_crud, "get_workspace_document", lookup)
    monkeypatch.setattr(
        document_operations,
        "document_to_schema",
        lambda value, include_content: {"id": value.id, "include_content": include_content},
    )

    result = await document_operations.get_workspace_document("workspace", "document", AsyncMock(), "tenant", False)

    assert result == {"id": "document", "include_content": False}
    lookup.assert_awaited_once_with(ANY, "document", "workspace", "tenant")


async def test_workspace_source_resolver_hides_foreign_documents(monkeypatch):
    monkeypatch.setattr(document_operations.document_crud, "get_workspace_document", AsyncMock(return_value=None))

    with pytest.raises(NotFoundError):
        await document_operations.get_workspace_document("workspace", "foreign-document", AsyncMock(), "tenant", False)
