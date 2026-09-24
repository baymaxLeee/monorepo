"""Idempotent source conversion invoked by Executor's durable Workflow."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime

from bootstrap.config import get_settings
from infrastructure.persistence.database import get_engine, get_session_factory, write_tx
from infrastructure.persistence.repositories import documents as document_crud
from kernel.errors import BaseError
from sqlalchemy import text

from application.admin_client import ProviderSnapshot, get_admin_client
from application.asset_client import get_asset_client
from application.convert import ConvertService

logger = logging.getLogger("knowledge.processor")


def _lock_key(document_id: str) -> int:
    digest = hashlib.blake2b(f"convert:{document_id}".encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


async def convert_document(document_id: str, *, provider_id: str | None = None) -> str:
    """Convert one stored source under a cluster-wide, replay-safe lock."""
    key = _lock_key(document_id)
    async with get_engine().connect() as lock_conn:
        await lock_conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": key})
        await lock_conn.commit()
        try:
            return await _convert_once(document_id, provider_id=provider_id)
        finally:
            await lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
            await lock_conn.commit()


async def _convert_once(document_id: str, *, provider_id: str | None) -> str:
    factory = get_session_factory()
    cached_markdown: str | None = None
    async with factory() as session, write_tx(session):
        row = await document_crud.get_document_by_id(session, document_id)
        if row is None:
            return "deleted"
        if row.kind != "source":
            return "not-source"
        if row.ingest_status == "ready" and row.content_md:
            return "already-ready"
        if not row.asset_id or not row.source_revision_id or not row.tenant_id or not row.workspace_id:
            await document_crud.update_document(
                session, row, {"ingest_status": "failed", "ingest_error": "document has no source Asset revision"}
            )
            return "failed"
        source_mime = row.source_mime_type or row.mime_type
        source_filename = row.source_filename or row.filename
        workspace_id = row.workspace_id
        tenant_id = row.tenant_id
        user_id = row.user_id
        captured_updated_at = row.updated_at
        source_sha256 = row.source_sha256
        asset_id = row.asset_id
        source_revision_id = row.source_revision_id
        is_media = source_mime.lower().startswith(("image/", "audio/", "video/"))
        if not is_media and source_sha256:
            cached_markdown = await document_crud.find_converted_cache(
                session,
                source_sha256=source_sha256,
                workspace_id=workspace_id,
                tenant_id=tenant_id,
                user_id=user_id,
                exclude_document_id=document_id,
            )
        await document_crud.set_ingest_status(
            session, document_id, status="converting", progress=row.ingest_progress, error=None
        )
    try:
        if cached_markdown is not None:
            markdown = cached_markdown
        else:
            content = await get_asset_client().read(
                tenant_id=tenant_id, workspace_id=workspace_id, asset_id=asset_id,
                revision_id=source_revision_id, max_bytes=get_settings().attachment_max_upload_bytes,
            )
            provider = await _resolve_provider(
                source_mime, workspace_id=workspace_id, tenant_id=tenant_id, provider_id=provider_id
            )
            settings = get_settings()
            markdown = await asyncio.wait_for(
                ConvertService().convert(
                    filename=source_filename, mime_type=source_mime, content=content, provider=provider
                ),
                timeout=max(settings.llm_timeout_seconds * 2, 90),
            )
    except Exception as exc:
        await _mark_failed(document_id, str(exc), expected_updated_at=captured_updated_at)
        raise
    async with factory() as session, write_tx(session):
        fresh = await document_crud.get_document_by_id(session, document_id)
        if fresh is None:
            return "deleted"
        updated = await document_crud.apply_conversion_if_unchanged(
            session,
            document_id,
            {
                "content_md": markdown,
                "mime_type": "text/markdown",
                "ingest_status": "ready",
                "ingest_progress": 100,
                "ingest_error": None,
                "index_status": "pending",
            },
            expected_updated_at=captured_updated_at,
        )
        if not updated:
            logger.info("conversion result for %s superseded by a newer edit", document_id)
            return "superseded"
    return "ready"


async def _resolve_provider(
    mime_type: str, *, workspace_id: str | None, tenant_id: str | None, provider_id: str | None
) -> ProviderSnapshot | None:
    if not mime_type.lower().startswith(("image/", "audio/", "video/")):
        return None
    try:
        return await get_admin_client().get_provider(
            workspace_id=workspace_id or "", tenant_id=tenant_id or "", provider_id=provider_id
        )
    except BaseError:
        return None


async def _mark_failed(document_id: str, message: str, *, expected_updated_at: datetime) -> None:
    try:
        factory = get_session_factory()
        async with factory() as session, write_tx(session):
            row = await document_crud.get_document_by_id(session, document_id)
            if row is not None:
                await document_crud.apply_conversion_if_unchanged(
                    session,
                    document_id,
                    {"ingest_status": "failed", "ingest_error": message[:500]},
                    expected_updated_at=expected_updated_at,
                )
    except Exception:
        logger.exception("failed to mark convert failure for %s", document_id)
