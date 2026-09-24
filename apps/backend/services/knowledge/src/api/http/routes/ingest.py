"""Public ingest endpoints."""

import json

from application.contracts.document import IngestResult
from application.ingest import ingest_documents, parse_ingest_items
from bootstrap.config import get_settings
from fastapi import APIRouter, Form, UploadFile
from kernel.errors import RequestError

from api.http.dependencies import CurrentUser

router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post("", response_model=IngestResult)
async def ingest(
    current_user: CurrentUser,
    files: list[UploadFile],
    client_refs: str = Form(...),
    conversation_id: str | None = Form(default=None),
    provider_id: str | None = Form(default=None),
) -> IngestResult:
    """Upload files, store raw bytes, and schedule background conversion."""
    try:
        refs = json.loads(client_refs)
    except json.JSONDecodeError as exc:
        raise RequestError("client_refs must be a JSON array") from exc
    if not isinstance(refs, list) or not all(isinstance(r, str) for r in refs):
        raise RequestError("client_refs must be a JSON array of strings")
    if len(files) != len(refs):
        raise RequestError("files and client_refs length mismatch")

    settings = get_settings()
    if not files:
        raise RequestError("at least one file is required")
    if len(files) > settings.ingest_max_files:
        raise RequestError("too many files", details={"max_files": settings.ingest_max_files})

    payload: list[tuple[str, bytes, str]] = []
    total_bytes = 0
    for upload in files:
        content = await upload.read(settings.attachment_max_upload_bytes + 1)
        if len(content) > settings.attachment_max_upload_bytes:
            raise RequestError(
                "attachment too large",
                details={"filename": upload.filename, "max_bytes": settings.attachment_max_upload_bytes},
            )
        total_bytes += len(content)
        if total_bytes > settings.ingest_max_batch_bytes:
            raise RequestError(
                "ingest batch too large", details={"max_bytes": settings.ingest_max_batch_bytes}
            )
        payload.append(
            (
                upload.filename or "attachment",
                content,
                upload.content_type or "application/octet-stream",
            )
        )
    items = parse_ingest_items(files=payload, client_refs=refs)
    return await ingest_documents(
        current_user=current_user,
        conversation_id=conversation_id,
        provider_id=provider_id,
        items=items,
    )
