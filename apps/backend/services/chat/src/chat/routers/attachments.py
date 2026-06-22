"""Attachment conversion endpoints."""

from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from chat.deps import CurrentUser
from chat.schemas.attachment import ConvertedAttachment
from chat.services.attachments import AttachmentService, AttachmentTooLargeError

router = APIRouter(prefix="/attachments", tags=["attachments"])


@router.post("/convert", response_model=ConvertedAttachment)
async def convert_attachment(
    _current_user: CurrentUser,
    file: Annotated[UploadFile, File(...)],
) -> ConvertedAttachment:
    """Convert one uploaded file to Markdown for LLM context."""

    svc = AttachmentService()
    max_bytes = svc.max_upload_bytes
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise AttachmentTooLargeError(
            "attachment exceeds the chat conversion demo limit",
            details={"max_bytes": max_bytes, "actual_bytes": len(content)},
        )
    return await svc.convert(
        filename=file.filename or "attachment",
        mime_type=file.content_type or "application/octet-stream",
        content=content,
    )
