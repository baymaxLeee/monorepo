"""Attachment conversion via Microsoft MarkItDown."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

import anyio
from kernel.errors import BaseError, RequestError
from markitdown import MarkItDown, StreamInfo

from chat.config import get_settings
from chat.schemas.attachment import ConvertedAttachment


class AttachmentTooLargeError(BaseError):
    status_code = 413
    code = "attachment_too_large"


class AttachmentConversionError(BaseError):
    status_code = 422
    code = "attachment_conversion_failed"


class AttachmentService:
    def __init__(self) -> None:
        self._settings = get_settings()

    @property
    def max_upload_bytes(self) -> int:
        return self._settings.attachment_max_upload_bytes

    async def convert(
        self,
        *,
        filename: str,
        mime_type: str,
        content: bytes,
    ) -> ConvertedAttachment:
        if not filename.strip():
            raise RequestError("attachment filename is required")
        if not content:
            raise RequestError("attachment is empty")
        if len(content) > self._settings.attachment_max_upload_bytes:
            raise AttachmentTooLargeError(
                "attachment exceeds the chat conversion demo limit",
                details={
                    "max_bytes": self._settings.attachment_max_upload_bytes,
                    "actual_bytes": len(content),
                },
            )

        try:
            markdown = await anyio.to_thread.run_sync(
                self._convert_sync,
                filename,
                mime_type,
                content,
            )
        except BaseError:
            raise
        except Exception as exc:
            raise AttachmentConversionError(
                "MarkItDown could not convert this attachment",
                details={"filename": filename, "reason": str(exc)},
            ) from exc

        markdown = markdown.strip()
        if not markdown:
            raise AttachmentConversionError(
                "MarkItDown returned empty markdown",
                details={"filename": filename},
            )

        max_chars = self._settings.attachment_markdown_max_chars
        truncated = len(markdown) > max_chars
        if truncated:
            markdown = markdown[:max_chars].rstrip() + "\n\n...[truncated for chat demo]"

        return ConvertedAttachment(
            filename=filename,
            mime_type=mime_type or "application/octet-stream",
            size=len(content),
            markdown=markdown,
            markdown_chars=len(markdown),
            truncated=truncated,
        )

    @staticmethod
    def _convert_sync(filename: str, mime_type: str, content: bytes) -> str:
        converter = MarkItDown(enable_plugins=False)
        result = converter.convert_stream(
            BytesIO(content),
            stream_info=StreamInfo(
                filename=filename,
                extension=Path(filename).suffix or None,
                mimetype=mime_type or None,
            ),
        )
        return result.text_content
