from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from infrastructure.persistence.models.document import DocumentRow
from kernel.errors import ConflictError
from pydantic import ValidationError

from application import conversation_fork as service
from application.contracts.conversation_fork import ForkConversationFilesInput


def payload(**patch):
    return ForkConversationFilesInput(
        **dict(
            source_conversation_id="source",
            conversation_id="branch",
            user_id="user",
            tenant_id="tenant",
            workspace_id="workspace",
            **patch,
        )
    )


def document(**patch):
    values = dict(
        id="original",
        user_id="user",
        tenant_id="tenant",
        workspace_id="workspace",
        conversation_id="source",
        kind="source",
        title="上传文件",
        filename="notes.pdf",
        content_md="解析内容",
        source_mime_type="application/pdf",
        mime_type="text/markdown",
        source_size=20,
        asset_id="asset",
        source_revision_id="revision",
        source_sha256="checksum",
        ingest_status="ready",
        index_status="ready",
        editable_source=False,
    )
    return DocumentRow(**(values | patch))


def test_snapshot_retains_original_bytes_without_duplicating_upload_or_indexing():
    source = document()
    copy = service.snapshot_document(source, payload())
    assert copy.id != source.id
    assert copy.asset_id == source.asset_id
    assert copy.source_revision_id == source.source_revision_id
    assert copy.content_md == source.content_md
    assert copy.conversation_id == "branch"
    assert copy.kind == "artifact"
    assert copy.index_status == "skipped"
    assert source.conversation_id == "source"
    assert source.kind == "source"
    assert source.index_status == "ready"


@pytest.mark.parametrize(
    "patch", [{"tenant_id": "other"}, {"workspace_id": "other"}, {"ingest_status": "converting"}, {"asset_id": None}]
)
def test_unavailable_or_cross_scope_files_reject_snapshot(patch):
    with pytest.raises(ConflictError):
        service.snapshot_document(document(**patch), payload())


def test_target_must_be_a_new_conversation():
    with pytest.raises(ValidationError):
        ForkConversationFilesInput(
            source_conversation_id="same", conversation_id="same", user_id="u", tenant_id="t", workspace_id="w"
        )


async def test_snapshots_and_durable_claims_share_transaction(monkeypatch):
    entered = []

    @asynccontextmanager
    async def transaction(session):
        entered.append(True)
        yield
        entered.pop()

    monkeypatch.setattr(service, "write_tx", transaction)
    lock = AsyncMock()
    monkeypatch.setattr(service, "assert_conversation_accepts_artifacts", lock)
    claim = AsyncMock()
    monkeypatch.setattr(service, "ensure_document_claim_active", claim)

    def stage(_row):
        assert entered

    session = SimpleNamespace(
        scalar=AsyncMock(return_value=None),
        scalars=AsyncMock(side_effect=[[document()], []]),
        add=Mock(side_effect=stage),
    )
    result = await service.fork_conversation_files(session, payload())
    copy = session.add.call_args.args[0]
    assert result.document_ids == {"original": copy.id}
    assert result.paths == {"sources/original-notes.pdf": f"documents/{copy.id}"}
    claim.assert_awaited_once_with(
        session,
        tenant_id="tenant",
        workspace_id="workspace",
        document_id=copy.id,
        asset_id="asset",
        revision_id="revision",
    )
    assert {call.kwargs["conversation_id"] for call in lock.await_args_list} == {"branch", "source"}


async def test_cleanup_tombstone_blocks_new_claims(monkeypatch):
    @asynccontextmanager
    async def transaction(session):
        yield

    monkeypatch.setattr(service, "write_tx", transaction)
    monkeypatch.setattr(
        service, "assert_conversation_accepts_artifacts", AsyncMock(side_effect=ConflictError("deleted"))
    )
    session = SimpleNamespace(scalar=AsyncMock(), scalars=AsyncMock(), add=Mock())
    with pytest.raises(ConflictError, match="deleted"):
        await service.fork_conversation_files(session, payload())
    session.add.assert_not_called()
    session.scalars.assert_not_awaited()
