"""Register immutable Asset revisions as source documents."""

from __future__ import annotations

import asyncio
from hashlib import blake2b

from bootstrap.config import get_settings
from infrastructure.persistence.database import get_session_factory, write_tx
from infrastructure.persistence.repositories import documents as document_crud
from kernel.errors import BaseError

from application.asset_client import ensure_document_claim_active, get_asset_client
from application.auth import AuthContext
from application.contracts.document import AssetIngestItem, IngestFailure, IngestReceipt, IngestResult
from application.documents import document_to_schema
from application.executor_client import dispatch_document_now


def _document_id(current_user: AuthContext, conversation_id: str | None, client_ref: str) -> str:
    scope = f"{current_user.tenant_id}\0{current_user.workspace_id}\0{current_user.user_id}\0{conversation_id or ''}\0{client_ref}"
    return blake2b(scope.encode(), digest_size=8).hexdigest()


async def ingest_assets(
    *,
    current_user: AuthContext,
    conversation_id: str | None,
    provider_id: str | None,
    items: list[AssetIngestItem],
) -> IngestResult:
    settings = get_settings()
    client = get_asset_client()
    factory = get_session_factory()
    semaphore = asyncio.Semaphore(settings.ingest_max_parallel)

    async def ingest_one(index: int, item: AssetIngestItem) -> IngestReceipt | IngestFailure:
        document_id = _document_id(current_user, conversation_id, item.client_ref)
        try:
            async with semaphore:
                asset = await client.describe(
                    tenant_id=current_user.tenant_id,
                    workspace_id=current_user.workspace_id,
                    asset_id=item.asset_id,
                    revision_id=item.revision_id,
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
                index=index, client_ref=item.client_ref, artifact_id=None, error=str(exc),
                code=exc.code if isinstance(exc, BaseError) else None,
            )

    results = await asyncio.gather(*(ingest_one(index, item) for index, item in enumerate(items)))
    return IngestResult(
        documents=[item for item in results if isinstance(item, IngestReceipt)],
        failed=[item for item in results if isinstance(item, IngestFailure)],
    )
