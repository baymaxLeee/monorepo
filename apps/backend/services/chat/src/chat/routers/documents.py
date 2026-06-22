"""Conversation document endpoints."""

from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from chat.deps import CurrentUser, DbSession
from chat.schemas.document import (
    ConversationDocument,
    ConversationDocumentDetail,
    UpdateConversationDocumentInput,
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


@router.get("/{document_id}", response_model=ConversationDocumentDetail)
async def get_document(
    conversation_id: str,
    document_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> ConversationDocumentDetail:
    return await ConversationDocumentService(session, current_user).get(conversation_id, document_id)


@router.patch("/{document_id}", response_model=ConversationDocumentDetail)
async def update_document(
    conversation_id: str,
    document_id: str,
    payload: UpdateConversationDocumentInput,
    current_user: CurrentUser,
    session: DbSession,
) -> ConversationDocumentDetail:
    return await ConversationDocumentService(session, current_user).update(conversation_id, document_id, payload)
