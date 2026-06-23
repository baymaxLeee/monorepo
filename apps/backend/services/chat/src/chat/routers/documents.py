"""Conversation document endpoints."""

import json
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import Response
from kernel.errors import RequestError

from chat.deps import CurrentUser, DbSession
from chat.schemas.document import (
    ConversationDocument,
    ConversationDocumentDetail,
    UpdateConversationDocumentInput,
)
from chat.services.document_ingest import (
    parse_ingest_items,
    sse_response,
    stream_ingest_events,
)
from chat.services.documents import ConversationDocumentService

router = APIRouter(prefix="/conversations/{conversation_id}/documents", tags=["documents"])


@router.get("", response_model=list[ConversationDocument])
async def list_documents(
    conversation_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> list[ConversationDocument]:
    return await ConversationDocumentService(session, current_user).list(conversation_id)


@router.post("", response_model=ConversationDocumentDetail, status_code=201)
async def upload_document(
    conversation_id: str,
    current_user: CurrentUser,
    session: DbSession,
    file: Annotated[UploadFile, File()],
) -> ConversationDocumentDetail:
    return await ConversationDocumentService(session, current_user).upload(conversation_id, file)


@router.post("/ingest/stream")
async def ingest_documents_stream(
    conversation_id: str,
    current_user: CurrentUser,
    session: DbSession,
    files: Annotated[list[UploadFile], File()],
    client_refs: Annotated[str, Form()],
):
    if not files:
        raise RequestError("at least one file is required")
    try:
        refs = json.loads(client_refs)
    except json.JSONDecodeError as exc:
        raise RequestError("client_refs must be a JSON array") from exc
    if not isinstance(refs, list) or not all(isinstance(ref, str) for ref in refs):
        raise RequestError("client_refs must be a JSON array of strings")

    service = ConversationDocumentService(session, current_user)
    await service.list(conversation_id)

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
            items=items,
        )
    )


@router.get("/{document_id}", response_model=ConversationDocumentDetail)
async def get_document(
    conversation_id: str,
    document_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> ConversationDocumentDetail:
    return await ConversationDocumentService(session, current_user).get(conversation_id, document_id)


@router.get("/{document_id}/source")
async def get_document_source(
    conversation_id: str,
    document_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> Response:
    content, mime_type, filename = await ConversationDocumentService(
        session, current_user
    ).get_source_bytes(conversation_id, document_id)
    return Response(
        content=content,
        media_type=mime_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.patch("/{document_id}", response_model=ConversationDocumentDetail)
async def update_document(
    conversation_id: str,
    document_id: str,
    payload: UpdateConversationDocumentInput,
    current_user: CurrentUser,
    session: DbSession,
) -> ConversationDocumentDetail:
    return await ConversationDocumentService(session, current_user).update(conversation_id, document_id, payload)
