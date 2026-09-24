"""Register immutable Asset revisions as source documents."""

from __future__ import annotations

import asyncio
from hashlib import blake2b

from bootstrap.config import get_settings
from infrastructure.persistence.database import get_session_factory, write_tx
from infrastructure.persistence.repositories import documents as document_crud
from kernel.errors import BaseError, RequestError

from application.asset_client import ensure_document_claim_active, get_asset_client
from application.auth import AuthContext
from application.contracts.document import (
    IngestFailure,
    IngestReceipt,
    IngestResult,
    PrepareSourceUploadsResult,
    SourceUploadCompletion,
    SourceUploadIntentInput,
    SourceUploadPlan,
)
from application.documents import document_to_schema
from application.executor_client import dispatch_document_now


def _document_id(current_user: AuthContext, conversation_id: str | None, client_ref: str) -> str:
    scope = f"{current_user.tenant_id}\0{current_user.workspace_id}\0{current_user.user_id}\0{conversation_id or ''}\0{client_ref}"
    return blake2b(scope.encode(), digest_size=8).hexdigest()


def _upload_intent_id(current_user: AuthContext, conversation_id: str | None, client_ref: str) -> str:
    return f"knowledge-source:{_document_id(current_user, conversation_id, client_ref)}"


async def prepare_source_uploads(
    *, current_user: AuthContext, conversation_id: str | None, files: list[SourceUploadIntentInput]
) -> PrepareSourceUploadsResult:
    settings = get_settings()
    if len(files) > settings.ingest_max_files:
        raise RequestError("too many files in one ingest request")
    if len({item.client_ref for item in files}) != len(files):
        raise RequestError("client_ref values must be unique within one ingest request")
    if any(item.size_bytes > settings.attachment_max_upload_bytes for item in files):
        raise RequestError("a file exceeds the Knowledge upload limit")
    if sum(item.size_bytes for item in files) > settings.ingest_max_batch_bytes:
        raise RequestError("ingest batch exceeds the Knowledge upload limit")

    client = get_asset_client()
    semaphore = asyncio.Semaphore(settings.ingest_max_parallel)

    async def prepare(item: SourceUploadIntentInput) -> SourceUploadPlan:
        async with semaphore:
            session = await client.create_upload_session(
                tenant_id=current_user.tenant_id,
                workspace_id=current_user.workspace_id,
                user_id=current_user.user_id,
                intent_id=_upload_intent_id(current_user, conversation_id, item.client_ref),
                filename=item.filename,
                media_type=item.media_type,
                size_bytes=item.size_bytes,
                category="knowledge-source",
            )
        return SourceUploadPlan(
            client_ref=item.client_ref,
            upload_session_id=session.upload_session_id,
            intent_id=session.intent_id,
            state=session.state,
            upload_url=session.upload_url,
            expires_at=session.expires_at.isoformat(),
            asset_id=session.asset_id,
            revision_id=session.revision_id,
        )

    return PrepareSourceUploadsResult(uploads=list(await asyncio.gather(*(prepare(item) for item in files))))


async def ingest_assets(
    *,
    current_user: AuthContext,
    conversation_id: str | None,
    provider_id: str | None,
    items: list[SourceUploadCompletion],
) -> IngestResult:
    settings = get_settings()
    client = get_asset_client()
    factory = get_session_factory()
    semaphore = asyncio.Semaphore(settings.ingest_max_parallel)

    async def ingest_one(index: int, item: SourceUploadCompletion) -> IngestReceipt | IngestFailure:
        document_id = _document_id(current_user, conversation_id, item.client_ref)
        try:
            async with semaphore:
                upload = await client.get_upload_session(
                    tenant_id=current_user.tenant_id,
                    workspace_id=current_user.workspace_id,
                    upload_session_id=item.upload_session_id,
                )
                if upload.intent_id != _upload_intent_id(current_user, conversation_id, item.client_ref):
                    raise ValueError("upload session does not belong to this document intent")
                if upload.user_id != current_user.user_id or upload.category != "knowledge-source":
                    raise ValueError("upload session does not belong to the current user or purpose")
                if upload.state != "completed" or not upload.asset_id or not upload.revision_id:
                    raise ValueError("upload session is not complete")
                asset = await client.describe(
                    tenant_id=current_user.tenant_id,
                    workspace_id=current_user.workspace_id,
                    asset_id=upload.asset_id,
                    revision_id=upload.revision_id,
                )
            if asset.created_by != current_user.user_id:
                raise ValueError("asset was not uploaded by the current user")
            if asset.size_bytes > settings.attachment_max_upload_bytes:
                raise ValueError("asset exceeds Knowledge conversion limit")
            async with factory() as session, write_tx(session):
                existing = await document_crud.get_document_by_id(session, document_id)
                if existing is not None:
                    if existing.asset_id != asset.asset_id or existing.source_revision_id != asset.revision_id:
                        raise ValueError("client_ref was already used for a different asset")
                    row = existing
                else:
                    row = await document_crud.create_document(
                        session,
                        document_id=document_id,
                        user_id=current_user.user_id,
                        workspace_id=current_user.workspace_id,
                        tenant_id=current_user.tenant_id,
                        conversation_id=conversation_id,
                        kind="source",
                        title=asset.filename,
                        filename=asset.filename,
                        mime_type="text/markdown",
                        source_size=asset.size_bytes,
                        source_mime_type=asset.media_type,
                        source_filename=asset.filename,
                        source_sha256=asset.sha256,
                        asset_id=asset.asset_id,
                        source_revision_id=asset.revision_id,
                        conversion_provider_id=provider_id,
                        ingest_status="received",
                        ingest_progress=100,
                    )
                    await ensure_document_claim_active(
                        session,
                        tenant_id=current_user.tenant_id,
                        workspace_id=current_user.workspace_id,
                        document_id=row.id,
                        asset_id=asset.asset_id,
                        revision_id=asset.revision_id,
                    )
            await dispatch_document_now(row.id, updated_at=row.updated_at, provider_id=provider_id)
            return IngestReceipt(index=index, client_ref=item.client_ref, document=document_to_schema(row))
        except Exception as exc:
            return IngestFailure(
                index=index,
                client_ref=item.client_ref,
                artifact_id=None,
                error=str(exc),
                code=exc.code if isinstance(exc, BaseError) else None,
            )

    results = await asyncio.gather(*(ingest_one(index, item) for index, item in enumerate(items)))
    return IngestResult(
        documents=[item for item in results if isinstance(item, IngestReceipt)],
        failed=[item for item in results if isinstance(item, IngestFailure)],
    )
