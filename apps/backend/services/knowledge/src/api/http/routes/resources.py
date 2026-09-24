"""Authenticated resource URL minting and signed source delivery."""

from datetime import UTC, datetime

from application.asset_client import get_asset_client
from application.contracts.resource import DocumentResourceURL, FileResourceURLInput
from application.resource_urls import (
    create_document_resource_url,
    create_file_resource_url,
    document_resource_version,
    verify_document_resource_url,
    verify_file_resource_url,
)
from fastapi import APIRouter, Query
from fastapi.responses import Response, StreamingResponse
from infrastructure.persistence.models.file_store import FileEntryRow
from infrastructure.persistence.repositories import documents as document_crud
from kernel.errors import NotFoundError, RequestError
from sqlalchemy import select

from api.http.dependencies import CurrentUser, DbSession

router = APIRouter(tags=["document-resources"])


@router.post("/documents/{document_id}/resource-url", response_model=DocumentResourceURL)
async def create_resource_url(document_id: str, current_user: CurrentUser, session: DbSession) -> DocumentResourceURL:
    row = await document_crud.get_workspace_document(
        session, document_id, current_user.workspace_id, current_user.tenant_id
    )
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    if not row.asset_id or not row.source_revision_id:
        raise NotFoundError("document has no source Asset revision")
    media_type = (row.source_mime_type or row.mime_type or "").lower()
    if not (
        media_type == "text/html"
        or media_type.startswith("video/")
        or media_type.startswith("audio/")
        or ("pdf" in media_type)
    ):
        raise RequestError("temporary resource URLs currently support HTML, video, audio, and PDF")
    url, expires_at = create_document_resource_url(row)
    return DocumentResourceURL(
        url=url,
        expires_at=expires_at,
        mime_type=media_type or "application/octet-stream",
        filename=row.source_filename or row.filename,
    )


@router.post("/files/resource-url", response_model=DocumentResourceURL)
async def create_file_url(
    payload: FileResourceURLInput, current_user: CurrentUser, session: DbSession
) -> DocumentResourceURL:
    row = await session.scalar(
        select(FileEntryRow).where(
            FileEntryRow.user_id == current_user.user_id,
            (FileEntryRow.workspace_id == current_user.workspace_id)
            & (FileEntryRow.tenant_id == current_user.tenant_id),
            FileEntryRow.conversation_id == payload.conversation_id,
            FileEntryRow.path == payload.path,
        )
    )
    if row is None:
        raise NotFoundError(f"file {payload.path} not found")
    if row.mime_type.lower() != "text/html":
        raise RequestError("temporary virtual file URLs currently support HTML")
    url, expires_at = create_file_resource_url(row.id, row.sha256)
    return DocumentResourceURL(
        url=url, expires_at=expires_at, mime_type=row.mime_type, filename=row.path.rsplit("/", 1)[-1]
    )


@router.get("/resources/{document_id}", response_class=StreamingResponse)
async def get_signed_resource(
    document_id: str,
    session: DbSession,
    expires: int = Query(..., ge=1),
    version: str = Query(..., min_length=1, max_length=128),
    signature: str = Query(..., min_length=64, max_length=64),
) -> StreamingResponse:
    if not verify_document_resource_url(document_id=document_id, version=version, expires=expires, signature=signature):
        raise NotFoundError("resource URL is invalid or expired")
    row = await document_crud.get_document_by_id(session, document_id)
    if (
        row is None
        or not row.asset_id
        or not row.source_revision_id
        or not row.tenant_id
        or not row.workspace_id
        or document_resource_version(row) != version
    ):
        raise NotFoundError("resource URL is invalid or expired")
    remaining_seconds = max(0, expires - int(datetime.now(UTC).timestamp()))
    chunks, asset_headers = await get_asset_client().open_stream(
        tenant_id=row.tenant_id, workspace_id=row.workspace_id,
        asset_id=row.asset_id, revision_id=row.source_revision_id,
    )
    return StreamingResponse(
        chunks,
        media_type=row.source_mime_type or "application/octet-stream",
        headers={
            "Cache-Control": f"private, max-age={remaining_seconds}",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": f'inline; filename="{row.source_filename or row.filename}"',
            **({"Content-Length": asset_headers["Content-Length"]} if "Content-Length" in asset_headers else {}),
            **({"ETag": asset_headers["ETag"]} if "ETag" in asset_headers else {}),
        },
    )


@router.get("/resources/files/{file_id}", response_class=Response)
async def get_signed_file_resource(
    file_id: str,
    session: DbSession,
    expires: int = Query(..., ge=1),
    version: str = Query(..., min_length=64, max_length=64),
    signature: str = Query(..., min_length=64, max_length=64),
) -> Response:
    if not verify_file_resource_url(file_id=file_id, version=version, expires=expires, signature=signature):
        raise NotFoundError("resource URL is invalid or expired")
    row = await session.scalar(select(FileEntryRow).where(FileEntryRow.id == file_id))
    if row is None or row.sha256 != version or row.mime_type.lower() != "text/html":
        raise NotFoundError("resource URL is invalid or expired")
    remaining_seconds = max(0, expires - int(datetime.now(UTC).timestamp()))
    return Response(
        content=row.content,
        media_type=row.mime_type,
        headers={
            "Cache-Control": f"private, max-age={remaining_seconds}",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    )
