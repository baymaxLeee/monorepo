"""Conversation document business service."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from fastapi import UploadFile
from kernel.errors import NotFoundError, RequestError
from sqlalchemy.ext.asyncio import AsyncSession

from chat.crud import conversations as conversation_crud
from chat.crud import documents as document_crud
from chat.deps import AuthContext
from chat.models.conversation import ConversationRow
from chat.models.document import ConversationDocumentRow
from chat.schemas.document import (
    ConversationDocument,
    ConversationDocumentDetail,
    DocumentKind,
    UpdateConversationDocumentInput,
)
from chat.services.attachments import AttachmentService, AttachmentTooLargeError


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def document_to_schema(row: ConversationDocumentRow) -> ConversationDocument:
    return ConversationDocument(
        id=row.id,
        conversation_id=row.conversation_id,
        kind=row.kind,  # type: ignore[arg-type]
        title=row.title,
        filename=row.filename,
        mime_type=row.mime_type,
        source_size=row.source_size,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


def document_to_detail(row: ConversationDocumentRow) -> ConversationDocumentDetail:
    return ConversationDocumentDetail(
        **document_to_schema(row).model_dump(),
        content_md=row.content_md,
    )


def document_ref(document_id: str) -> str:
    return f"[[chat-document:{document_id}]]"


def with_document_refs(content: str, documents: Sequence[ConversationDocumentRow]) -> str:
    refs = [document_ref(row.id) for row in documents]
    if not refs:
        return content
    return "\n\n".join([content, *refs]).strip()


def with_document_context(content: str, documents: Sequence[ConversationDocumentRow]) -> str:
    if not documents:
        return content
    blocks: list[str] = []
    for index, row in enumerate(documents, start=1):
        blocks.append(
            "\n".join(
                [
                    f"### Document {index}: {row.title}",
                    f"Document ID: {row.id}",
                    f"Filename: {row.filename}",
                    f"Kind: {row.kind}",
                    "",
                    row.content_md,
                ]
            )
        )
    return "\n\n".join(
        [
            content,
            "<conversation_documents converted_by='microsoft/markitdown'>",
            *blocks,
            "</conversation_documents>",
        ]
    )


class ConversationDocumentService:
    def __init__(self, session: AsyncSession, current_user: AuthContext) -> None:
        self._session = session
        self._current_user = current_user
        self._attachments = AttachmentService()

    async def list(self, conversation_id: str) -> list[ConversationDocument]:
        await self._get_conversation(conversation_id)
        rows = await document_crud.list_documents(self._session, conversation_id)
        return [document_to_schema(row) for row in rows]

    async def get(
        self,
        conversation_id: str,
        document_id: str,
    ) -> ConversationDocumentDetail:
        row = await self.get_row(conversation_id, document_id)
        return document_to_detail(row)

    async def upload(self, conversation_id: str, file: UploadFile) -> ConversationDocumentDetail:
        await self._get_conversation(conversation_id)
        content = await file.read(self._attachments.max_upload_bytes + 1)
        if len(content) > self._attachments.max_upload_bytes:
            raise AttachmentTooLargeError(
                "attachment exceeds the chat conversion demo limit",
                details={
                    "max_bytes": self._attachments.max_upload_bytes,
                    "actual_bytes": len(content),
                },
            )
        filename = Path(file.filename or "attachment").name or "attachment"
        converted = await self._attachments.convert(
            filename=filename,
            mime_type=file.content_type or "application/octet-stream",
            content=content,
        )
        row = await self.create_artifact_row(
            conversation_id=conversation_id,
            kind="source",
            title=filename,
            filename=filename,
            mime_type="text/markdown",
            content_md=converted.markdown,
            source_size=converted.size,
        )
        return document_to_detail(row)

    async def update(
        self,
        conversation_id: str,
        document_id: str,
        payload: UpdateConversationDocumentInput,
    ) -> ConversationDocumentDetail:
        row = await self.get_row(conversation_id, document_id)
        values = payload.model_dump(exclude_unset=True, exclude_none=True)
        if not values:
            return document_to_detail(row)
        updated = await document_crud.update_document(self._session, row, values)
        return document_to_detail(updated)

    async def create_artifact_row(
        self,
        *,
        conversation_id: str,
        kind: DocumentKind,
        title: str,
        filename: str,
        mime_type: str,
        content_md: str,
        source_size: int = 0,
    ) -> ConversationDocumentRow:
        if not content_md.strip():
            raise RequestError("document content is required")
        return await document_crud.create_document(
            self._session,
            conversation_id=conversation_id,
            kind=kind,
            title=title.strip(),
            filename=Path(filename or title).name or "artifact.md",
            mime_type=mime_type,
            content_md=content_md.strip(),
            source_size=source_size,
        )

    async def get_rows(
        self,
        conversation_id: str,
        document_ids: Sequence[str],
    ) -> Sequence[ConversationDocumentRow]:
        await self._get_conversation(conversation_id)
        rows = []
        seen: set[str] = set()
        for document_id in document_ids:
            if document_id in seen:
                continue
            seen.add(document_id)
            rows.append(await self.get_row(conversation_id, document_id))
        return rows

    async def get_row(
        self,
        conversation_id: str,
        document_id: str,
    ) -> ConversationDocumentRow:
        await self._get_conversation(conversation_id)
        row = await document_crud.get_document(
            self._session,
            conversation_id=conversation_id,
            document_id=document_id,
        )
        if row is None:
            raise NotFoundError(f"document {document_id} not found")
        return row

    async def _get_conversation(self, conversation_id: str) -> ConversationRow:
        row = await conversation_crud.get_conversation(
            self._session,
            conversation_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"conversation {conversation_id} not found")
        return row
