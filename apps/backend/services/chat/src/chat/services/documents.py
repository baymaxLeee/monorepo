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
from chat.services.admin_client import (
    AdminUnavailableError,
    ProviderNotConfiguredError,
    ProviderSnapshot,
    get_admin_client,
)
from chat.services.attachments import AttachmentService, AttachmentTooLargeError
from chat.services.storage_client import StorageClient


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
        source_mime_type=row.source_mime_type,
        source_object_bucket=row.source_object_bucket,
        source_object_key=row.source_object_key,
        source_sha256=row.source_sha256,
        source_filename=row.source_filename,
        ingest_status=row.ingest_status,  # type: ignore[arg-type]
        ingest_progress=row.ingest_progress,
        ingest_error=row.ingest_error,
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

    async def list_rows(self, conversation_id: str) -> Sequence[ConversationDocumentRow]:
        await self._get_conversation(conversation_id)
        return await document_crud.list_documents(self._session, conversation_id)

    async def get(
        self,
        conversation_id: str,
        document_id: str,
    ) -> ConversationDocumentDetail:
        row = await self.get_row(conversation_id, document_id)
        return document_to_detail(row)

    async def upload(self, conversation_id: str, file: UploadFile) -> ConversationDocumentDetail:
        conversation = await self._get_conversation(conversation_id)
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
        mime_type = file.content_type or "application/octet-stream"
        provider = None if _is_image_mime(mime_type) else await self._resolve_attachment_provider(conversation)
        converted = await self._attachments.convert(
            filename=filename,
            mime_type=mime_type,
            content=content,
            provider=provider,
        )
        storage = StorageClient()
        stored = await storage.put_bytes(
            content=content,
            filename=filename,
            mime_type=mime_type,
            user_id=self._current_user.user_id,
            prefix=f"conversations/{conversation_id}",
        )
        try:
            row = await self.create_artifact_row(
                conversation_id=conversation_id,
                kind="source",
                title=filename,
                filename=filename,
                mime_type="text/markdown",
                content_md=converted.markdown,
                source_size=converted.size,
                source_mime_type=converted.mime_type,
                source_object_bucket=stored.bucket,
                source_object_key=stored.key,
                source_sha256=stored.sha256,
                source_filename=filename,
            )
        except Exception:
            await storage.delete(bucket=stored.bucket, key=stored.key)
            raise
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
        source_mime_type: str | None = None,
        source_object_bucket: str | None = None,
        source_object_key: str | None = None,
        source_sha256: str | None = None,
        source_filename: str | None = None,
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
            source_mime_type=source_mime_type,
            source_object_bucket=source_object_bucket,
            source_object_key=source_object_key,
            source_sha256=source_sha256,
            source_filename=source_filename,
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

    async def get_source_bytes(
        self,
        conversation_id: str,
        document_id: str,
    ) -> tuple[bytes, str, str]:
        row = await self.get_row(conversation_id, document_id)
        if not row.source_object_bucket or not row.source_object_key:
            raise NotFoundError(f"document {document_id} has no stored source object")
        content = await StorageClient().get_bytes(
            bucket=row.source_object_bucket,
            key=row.source_object_key,
        )
        mime_type = row.source_mime_type or row.mime_type or "application/octet-stream"
        filename = row.source_filename or row.filename
        return content, mime_type, filename

    async def _resolve_attachment_provider(
        self,
        conversation: ConversationRow,
    ) -> ProviderSnapshot | None:
        """Best-effort provider for MarkItDown vision captions on images."""
        try:
            return await get_admin_client().get_provider(
                user_id=self._current_user.user_id,
                provider_id=conversation.provider_id or None,
            )
        except (ProviderNotConfiguredError, AdminUnavailableError):
            return None

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


def _is_image_mime(mime_type: str) -> bool:
    return mime_type.lower().startswith("image/")
