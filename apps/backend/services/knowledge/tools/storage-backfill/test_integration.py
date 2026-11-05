"""Explicit integration checks against disposable PostgreSQL and Storage instances.

Set KNOWLEDGE_TEST_DATABASE_URL (asyncpg SQLAlchemy URL), STORAGE_SERVICE_URL,
INTERNAL_API_TOKEN and KNOWLEDGE_BACKFILL_BINARY. Never point this at a user DB.
Run through `just test backend/knowledge tools/storage-backfill/test_integration.py`.
"""

import asyncio
import os
from contextlib import asynccontextmanager
from hashlib import sha256
from uuid import uuid4

import pytest
from api.http.routes import files_internal
from application import conversation_cleanup, storage_client
from application.contracts.conversation_cleanup import CleanupConversationArtifactsInput
from application.contracts.file_store import CreateChangeSetInput, PromoteChangeSetInput, WriteChangeSetFileInput
from application.storage_client import StorageClient
from bootstrap.config import Settings
from kernel.errors import ConflictError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@asynccontextmanager
async def database(monkeypatch):
    url = os.environ["KNOWLEDGE_TEST_DATABASE_URL"]
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    client = StorageClient(
        Settings(
            _env_file=None,
            storage_service_url=os.environ["STORAGE_SERVICE_URL"],
            internal_api_token=os.environ["INTERNAL_API_TOKEN"],
        )
    )
    monkeypatch.setattr(storage_client, "_client", client)
    monkeypatch.setattr(conversation_cleanup, "get_session_factory", lambda: factory)
    try:
        yield factory
    finally:
        await client.aclose()
        await engine.dispose()


async def backfill(*args):
    env = {**os.environ, "KNOWLEDGE_DATABASE_URL": os.environ["KNOWLEDGE_TEST_DATABASE_URL"].replace("+asyncpg", "")}
    proc = await asyncio.create_subprocess_exec(
        os.environ["KNOWLEDGE_BACKFILL_BINARY"],
        *args,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    output, _ = await proc.communicate()
    return proc.returncode, output.decode()


async def test_backfill_preserves_bytes_and_recovers_pending_claims(monkeypatch):
    body = "历史文件\n原始内容\n"
    digest = sha256(body.encode()).hexdigest()
    ident = uuid4().hex[:26]
    async with database(monkeypatch) as factory:
        async with factory() as session, session.begin():
            await session.execute(
                text("""INSERT INTO file_entries(id,user_id,tenant_id,workspace_id,conversation_id,path,mime_type,content,sha256,writable,derived,created_at,updated_at)
                VALUES(:id,'u','t','w',:id,'legacy.txt','text/plain',:body,:sha,true,false,now(),now())"""),
                {"id": ident, "body": body, "sha": digest},
            )
        status, output = await backfill()
        assert status == 0, output
        async with factory() as session:
            row = (
                await session.execute(
                    text("SELECT asset_id,revision_id,content,size_bytes FROM file_entries WHERE id=:id"), {"id": ident}
                )
            ).one()
            assert row.content is None
            assert row.size_bytes == len(body.encode())
            original_ids = row.asset_id, row.revision_id
        status, output = await backfill("--verify")
        assert status == 0, output
        # Simulate process loss between metadata commit and Claim relay completion.
        async with factory() as session, session.begin():
            await session.execute(
                text("UPDATE asset_claim_intents SET delivered_at=NULL WHERE owner_id=:id"), {"id": ident}
            )
        status, output = await backfill("--verify")
        assert status != 0
        assert "not been delivered" in output
        status, output = await backfill()
        assert status == 0, output
        status, output = await backfill("--verify")
        assert status == 0, output
        async with factory() as session:
            row = (
                await session.execute(text("SELECT asset_id,revision_id FROM file_entries WHERE id=:id"), {"id": ident})
            ).one()
            assert (row.asset_id, row.revision_id) == original_ids
            result = await files_internal.read_file(
                session, user_id="u", conversation_id=ident, path="legacy.txt", offset=1, limit=2000
            )
            assert result.content == body


async def test_file_publish_read_cleanup_and_closed_set_race(monkeypatch):
    conversation = uuid4().hex[:26]
    async with database(monkeypatch) as factory:
        async with factory() as session:
            change = await files_internal.create_change_set(
                CreateChangeSetInput(user_id="u", tenant_id="t", workspace_id="w", conversation_id=conversation),
                session,
            )
        async with factory() as session:
            entry = await files_internal.write_change_set_file(
                change.id,
                WriteChangeSetFileInput(user_id="u", path="report.txt", content="正文\n", mime_type="text/plain"),
                session,
            )
            assert entry.asset_id
            assert entry.revision_id
        async with factory() as session:
            published = await files_internal.promote_change_set(change.id, PromoteChangeSetInput(user_id="u"), session)
            assert published[0].asset_id == entry.asset_id
        async with factory() as session:
            read = await files_internal.read_file(
                session, user_id="u", conversation_id=conversation, path="report.txt", offset=1, limit=2000
            )
            assert read.content == "正文\n"
        async with factory() as session:
            race = await files_internal.create_change_set(
                CreateChangeSetInput(user_id="u", tenant_id="t", workspace_id="w", conversation_id=conversation),
                session,
            )
        uploaded, resume = asyncio.Event(), asyncio.Event()
        original_store = files_internal.store_text

        async def delayed_upload(**kwargs):
            revision = await original_store(**kwargs)
            uploaded.set()
            await resume.wait()
            return revision

        monkeypatch.setattr(files_internal, "store_text", delayed_upload)

        async def write_late():
            async with factory() as session:
                return await files_internal.write_change_set_file(
                    race.id,
                    WriteChangeSetFileInput(user_id="u", path="late.txt", content="late", mime_type="text/plain"),
                    session,
                )

        task = asyncio.create_task(write_late())
        await asyncio.wait_for(uploaded.wait(), 10)
        async with factory() as session:
            await files_internal.discard_change_set(race.id, PromoteChangeSetInput(user_id="u"), session)
        resume.set()
        with pytest.raises(ConflictError, match="discarded"):
            await task
        result = await conversation_cleanup.cleanup_conversation_artifacts(
            CleanupConversationArtifactsInput(
                user_id="u", tenant_id="t", workspace_id="w", conversation_id=conversation
            )
        )
        assert result.deleted_blocks == 1
        async with factory() as session:
            states = (
                (
                    await session.execute(
                        text("SELECT desired_state FROM asset_claim_intents WHERE asset_id=:id"), {"id": entry.asset_id}
                    )
                )
                .scalars()
                .all()
            )
            assert states
            assert all(state == "released" for state in states)
            remaining = await session.scalar(
                text("SELECT count(*) FROM file_change_set_entries WHERE change_set_id=:id"), {"id": race.id}
            )
            assert remaining == 0


async def test_editable_documents_publish_storage_revisions_and_reject_stale_edits(monkeypatch):
    from api.http.routes import documents_internal
    from application.contracts.document import CreateArtifactInput, UpdateArtifactInput

    conversation = uuid4().hex[:26]
    async with database(monkeypatch) as factory:
        payload = CreateArtifactInput(
            user_id="u",
            tenant_id="t",
            workspace_id="w",
            conversation_id=conversation,
            title="Plan",
            filename="plan.md",
            content="# 原始\n",
            idempotency_key="plan",
        )
        async with factory() as session:
            created = await documents_internal.create_artifact(payload, session)
        assert created.editable_source
        assert created.asset_id
        async with factory() as session:
            replay = await documents_internal.create_artifact(payload, session)
        assert replay.source_revision_id == created.source_revision_id
        async with factory() as session:
            edited = await documents_internal.update_artifact(
                created.id,
                UpdateArtifactInput(user_id="u", content="# 修改\n", expected_updated_at=created.updated_at),
                session,
            )
        assert edited.source_revision_id != created.source_revision_id
        client = storage_client.get_storage_client()
        for document, expected in [(created, "# 原始\n"), (edited, "# 修改\n")]:
            body = await client.read(
                tenant_id="t",
                workspace_id="w",
                asset_id=document.asset_id,
                revision_id=document.source_revision_id,
                max_bytes=document.source_size,
            )
            assert body == expected.encode()
        async with factory() as session:
            with pytest.raises(ConflictError, match="changed"):
                await documents_internal.update_artifact(
                    created.id,
                    UpdateArtifactInput(user_id="u", content="stale", expected_updated_at=created.updated_at),
                    session,
                )
        await conversation_cleanup.cleanup_conversation_artifacts(
            CleanupConversationArtifactsInput(
                user_id="u", tenant_id="t", workspace_id="w", conversation_id=conversation
            )
        )
        async with factory() as session:
            with pytest.raises(ConflictError, match="deleted"):
                await documents_internal.create_artifact(payload, session)
        async with factory() as session:
            with pytest.raises(ConflictError, match="deleted"):
                await files_internal.create_change_set(
                    CreateChangeSetInput(user_id="u", tenant_id="t", workspace_id="w", conversation_id=conversation),
                    session,
                )
