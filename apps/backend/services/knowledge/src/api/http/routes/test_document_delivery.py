from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from application.auth import AuthContext
from kernel.errors import NotFoundError

from api.http.routes import documents


async def test_owner_authorization_precedes_storage_signing(monkeypatch):
    user = AuthContext("user", "name", "email", "workspace", "tenant")
    lookup = AsyncMock(return_value=None)
    client = SimpleNamespace(mint_delivery=AsyncMock(return_value={"url": "signed-by-storage"}))
    monkeypatch.setattr(documents.document_crud, "get_workspace_document", lookup)
    monkeypatch.setattr(documents, "get_storage_client", lambda: client)
    with pytest.raises(NotFoundError):
        await documents.authorize_document_delivery("document", user, AsyncMock())
    client.mint_delivery.assert_not_awaited()
    lookup.return_value = SimpleNamespace(asset_id="asset", source_revision_id="revision")
    assert await documents.authorize_document_delivery("document", user, AsyncMock()) == {"url": "signed-by-storage"}
    client.mint_delivery.assert_awaited_once_with(
        tenant_id="tenant", workspace_id="workspace", asset_id="asset", revision_id="revision"
    )
