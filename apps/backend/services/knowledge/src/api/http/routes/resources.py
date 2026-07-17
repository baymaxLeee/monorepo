"""Authenticated resource URL minting and signed source delivery."""

from datetime import UTC, datetime

from application.contracts.resource import DocumentResourceURL
from application.object_store import ObjectStore
from application.resource_urls import (
    create_document_resource_url,
    document_resource_version,
    verify_document_resource_url,
)
from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from infrastructure.persistence.repositories import documents as document_crud
from kernel.errors import NotFoundError, RequestError

from api.http.dependencies import CurrentUser, DbSession

router = APIRouter(tags=["document-resources"])


@router.post(
    "/documents/{document_id}/resource-url",
    response_model=DocumentResourceURL,
)
async def create_resource_url(
    document_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> DocumentResourceURL:
    row = await document_crud.get_org_document(session, document_id, current_user.org_id)
    if row is None:
        raise NotFoundError(f"document {document_id} not found")
    if not row.object_bucket or not row.object_key:
        raise NotFoundError("document has no stored source object")
    media_type = (row.source_mime_type or row.mime_type or "").lower()
    if not (media_type.startswith("video/") or media_type.startswith("audio/") or "pdf" in media_type):
        raise RequestError("temporary resource URLs currently support video, audio, and PDF")
    url, expires_at = create_document_resource_url(row)
    return DocumentResourceURL(
        url=url,
        expires_at=expires_at,
        mime_type=media_type or "application/octet-stream",
        filename=row.source_filename or row.filename,
    )


@router.get("/resources/{document_id}", response_class=FileResponse)
async def get_signed_resource(
    document_id: str,
    session: DbSession,
    expires: int = Query(..., ge=1),
    version: str = Query(..., min_length=1, max_length=128),
    signature: str = Query(..., min_length=64, max_length=64),
) -> FileResponse:
    if not verify_document_resource_url(
        document_id=document_id,
        version=version,
        expires=expires,
        signature=signature,
    ):
        raise NotFoundError("resource URL is invalid or expired")
    row = await document_crud.get_document_by_id(session, document_id)
    if row is None or not row.object_bucket or not row.object_key or document_resource_version(row) != version:
        raise NotFoundError("resource URL is invalid or expired")
    path = ObjectStore().get_path(bucket=row.object_bucket, key=row.object_key)
    remaining_seconds = max(0, expires - int(datetime.now(UTC).timestamp()))
    return FileResponse(
        path,
        media_type=row.source_mime_type or "application/octet-stream",
        filename=row.source_filename or row.filename,
        content_disposition_type="inline",
        headers={
            "Cache-Control": f"private, max-age={remaining_seconds}",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    )
