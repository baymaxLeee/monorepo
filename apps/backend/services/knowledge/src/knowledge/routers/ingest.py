"""Public ingest endpoints."""

import json

from fastapi import APIRouter, Form, UploadFile
from kernel.errors import RequestError
from knowledge.deps import CurrentUser
from knowledge.schemas.document import IngestResult
from knowledge.services.ingest import ingest_documents, parse_ingest_items

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

    payload: list[tuple[str, bytes, str]] = []
    for upload in files:
        content = await upload.read()
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
