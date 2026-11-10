from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock

import pytest
from kernel.errors import NotFoundError

from api.http.routes import documents_internal


async def test_workspace_source_resolver_uses_tenant_and_workspace_acl(monkeypatch):
    row = SimpleNamespace(id="document")
    lookup = AsyncMock(return_value=row)
    monkeypatch.setattr(documents_internal.document_crud, "get_workspace_document", lookup)
    monkeypatch.setattr(
        documents_internal,
        "document_to_schema",
        lambda value, include_content: {"id": value.id, "include_content": include_content},
    )

    result = await documents_internal.get_workspace_document("workspace", "document", AsyncMock(), "tenant", False)

    assert result == {"id": "document", "include_content": False}
    lookup.assert_awaited_once_with(ANY, "document", "workspace", "tenant")


async def test_workspace_source_resolver_hides_foreign_documents(monkeypatch):
    monkeypatch.setattr(documents_internal.document_crud, "get_workspace_document", AsyncMock(return_value=None))

    with pytest.raises(NotFoundError):
        await documents_internal.get_workspace_document("workspace", "foreign-document", AsyncMock(), "tenant", False)
