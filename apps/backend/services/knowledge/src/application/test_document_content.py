from unittest.mock import AsyncMock

import pytest
from kernel.errors import ConflictError

from application import document_content
from application.storage_client import StorageRevision


def revision(*, digest: str, size: int) -> StorageRevision:
    return StorageRevision(
        asset_id="00000000-0000-0000-0000-000000000001",
        revision_id="00000000-0000-0000-0000-000000000002",
        category="knowledge-file",
        filename="notes.md",
        media_type="text/markdown",
        size_bytes=size,
        sha256=digest,
        created_by="user",
    )


async def test_document_text_publish_verifies_storage_bytes(monkeypatch):
    content = "semantic document"
    client = AsyncMock()
    from hashlib import sha256

    client.upload_text.return_value = revision(digest=sha256(content.encode()).hexdigest(), size=len(content.encode()))
    monkeypatch.setattr(document_content, "get_storage_client", lambda: client)

    result = await document_content.store_document_text(
        tenant_id="tenant",
        workspace_id="workspace",
        user_id="user",
        filename="folder/notes.md",
        media_type="text/markdown",
        content=content,
        operation_id="document:1",
    )

    assert result == client.upload_text.return_value
    assert client.upload_text.await_args.kwargs["filename"] == "notes.md"


async def test_document_text_publish_rejects_mismatched_revision(monkeypatch):
    client = AsyncMock()
    client.upload_text.return_value = revision(digest="0" * 64, size=1)
    monkeypatch.setattr(document_content, "get_storage_client", lambda: client)

    with pytest.raises(ConflictError, match="does not match"):
        await document_content.store_document_text(
            tenant_id="tenant",
            workspace_id="workspace",
            user_id="user",
            filename="notes.md",
            media_type="text/markdown",
            content="semantic document",
            operation_id="document:1",
        )
