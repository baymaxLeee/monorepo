"""Public ingest endpoints."""

import json

from fastapi import APIRouter, Form, UploadFile
from fastapi.responses import StreamingResponse
from kernel.errors import RequestError
from knowledge.deps import CurrentUser, DbSession
from knowledge.services.ingest import parse_ingest_items, sse_response, stream_ingest_events

router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post("/stream")
async def ingest_stream(
    current_user: CurrentUser,
    session: DbSession,
    files: list[UploadFile],
    client_refs: str = Form(...),
    conversation_id: str | None = Form(default=None),
    provider_id: str | None = Form(default=None),
) -> StreamingResponse:
    """Upload files, store raw bytes, convert to markdown, stream progress via SSE."""

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
    return sse_response(
        stream_ingest_events(
            session=session,
            current_user=current_user,
            conversation_id=conversation_id,
            provider_id=provider_id,
            items=items,
        )
    )
