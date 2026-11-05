from hashlib import sha256
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from kernel.errors import ConflictError

from application import file_content
from application.document_edits import apply_document_edit


async def test_file_read_uses_exact_storage_revision_and_checks_integrity(monkeypatch):
    body = "原始内容\n".encode()
    client = SimpleNamespace(read=AsyncMock(return_value=body))
    monkeypatch.setattr(file_content, "get_storage_client", lambda: client)
    row = SimpleNamespace(
        asset_id="asset", revision_id="revision", size_bytes=len(body), sha256=sha256(body).hexdigest()
    )
    assert await file_content.read_text(row, tenant_id="tenant", workspace_id="workspace") == body.decode()
    client.read.assert_awaited_once_with(
        tenant_id="tenant", workspace_id="workspace", asset_id="asset", revision_id="revision", max_bytes=len(body)
    )
    client.read.return_value = b"corrupted"
    with pytest.raises(ConflictError, match="checksum"):
        await file_content.read_text(row, tenant_id="tenant", workspace_id="workspace")


async def test_no_legacy_body_fallback(monkeypatch):
    row = SimpleNamespace(asset_id=None, revision_id=None, size_bytes=None, content="legacy bytes")
    client = SimpleNamespace(read=AsyncMock())
    monkeypatch.setattr(file_content, "get_storage_client", lambda: client)
    with pytest.raises(ConflictError, match="migration"):
        await file_content.read_text(row, tenant_id="tenant", workspace_id="workspace")
    client.read.assert_not_awaited()


async def test_immutable_artifact_edit_is_rejected_before_io():
    session = AsyncMock()
    row = SimpleNamespace(kind="artifact", editable_source=False)
    with pytest.raises(ConflictError, match="immutable"):
        await apply_document_edit(session, row, {"content_md": "changed"})
    session.execute.assert_not_awaited()


def test_knowledge_has_no_raw_delivery_or_signing_routes():
    from main import create_app

    paths = create_app().openapi()["paths"]
    assert not any(
        path.startswith("/resources") or path.endswith("/source") or path.endswith("/resource-url") for path in paths
    )
    assert "/documents/{document_id}/delivery" in paths
