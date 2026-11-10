from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from application.contracts.document import CreateStagedMediaInput
from kernel.errors import ConflictError

from api.http.routes import documents_internal


def payload(**patch: str) -> CreateStagedMediaInput:
    values = {
        "user_id": "user",
        "tenant_id": "tenant",
        "workspace_id": "workspace",
        "conversation_id": "conversation",
        "title": "video",
        "asset_id": "00000000-0000-0000-0000-000000000001",
        "revision_id": "00000000-0000-0000-0000-000000000002",
        "idempotency_key": "render:1",
    }
    return CreateStagedMediaInput.model_validate(values | patch)


async def test_replay_lookup_uses_complete_owner_scope(monkeypatch):
    row = SimpleNamespace(
        asset_id="00000000-0000-0000-0000-000000000001",
        revision_id="00000000-0000-0000-0000-000000000002",
    )
    lookup = AsyncMock(return_value=row)
    monkeypatch.setattr(documents_internal.staged_media_crud, "get_by_idempotency_key", lookup)
    session = AsyncMock()

    assert await documents_internal._find_staged_media_replay(session, payload()) is row
    lookup.assert_awaited_once_with(
        session,
        idempotency_key="render:1",
        user_id="user",
        tenant_id="tenant",
        workspace_id="workspace",
        conversation_id="conversation",
    )


async def test_replay_rejects_a_different_storage_revision(monkeypatch):
    lookup = AsyncMock(
        return_value=SimpleNamespace(
            asset_id="00000000-0000-0000-0000-000000000003",
            revision_id="00000000-0000-0000-0000-000000000004",
        )
    )
    monkeypatch.setattr(documents_internal.staged_media_crud, "get_by_idempotency_key", lookup)

    with pytest.raises(ConflictError, match="different Storage revision"):
        await documents_internal._find_staged_media_replay(AsyncMock(), payload())
