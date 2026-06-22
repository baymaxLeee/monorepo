"""Attachment conversion via Microsoft MarkItDown."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Any

import anyio
from kernel.errors import BaseError, RequestError
from markitdown import MarkItDown, StreamInfo
from openai import OpenAI

from chat.config import get_settings
from chat.schemas.attachment import ConvertedAttachment

if TYPE_CHECKING:
    from chat.services.admin_client import ProviderSnapshot


class AttachmentTooLargeError(BaseError):
    status_code = 413
    code = "attachment_too_large"


class AttachmentConversionError(BaseError):
    status_code = 422
    code = "attachment_conversion_failed"


class _BoundedCompletions:
    """Inject max_tokens into MarkItDown vision caption calls."""

    def __init__(self, completions: Any, max_tokens: int) -> None:
        self._completions = completions
        self._max_tokens = max_tokens

    def create(self, *args: Any, **kwargs: Any) -> Any:
        kwargs.setdefault("max_tokens", self._max_tokens)
        return self._completions.create(*args, **kwargs)


class _BoundedChat:
    def __init__(self, chat: Any, max_tokens: int) -> None:
        self._chat = chat
        self._max_tokens = max_tokens

    @property
    def completions(self) -> _BoundedCompletions:
        return _BoundedCompletions(self._chat.completions, self._max_tokens)


class _VisionCaptionClient:
    """OpenAI client wrapper used only for MarkItDown image captions."""

    def __init__(self, client: OpenAI, *, max_tokens: int) -> None:
        self._client = client
        self._max_tokens = max_tokens

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)

    @property
    def chat(self) -> _BoundedChat:
        return _BoundedChat(self._client.chat, self._max_tokens)


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
        provider: ProviderSnapshot | None = None,
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

        vision_note: str | None = None
        try:
            markdown = await anyio.to_thread.run_sync(
                self._convert_sync,
                filename,
                mime_type,
                content,
                provider,
            )
        except BaseError:
            raise
        except Exception as exc:
            if self._should_degrade_on_error(mime_type):
                vision_note = self._short_error(exc)
                markdown = ""
            else:
                raise AttachmentConversionError(
                    "MarkItDown could not convert this attachment",
                    details={"filename": filename, "reason": str(exc)},
                ) from exc

        markdown = markdown.strip()
        if not markdown:
            markdown = self._fallback_markdown(
                filename=filename,
                mime_type=mime_type,
                size=len(content),
                note=vision_note,
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
    def _should_degrade_on_error(mime_type: str) -> bool:
        lowered = mime_type.lower()
        return lowered.startswith(("image/", "audio/", "video/"))

    @staticmethod
    def _short_error(exc: Exception) -> str:
        text = str(exc).strip()
        if len(text) > 240:
            return text[:237] + "..."
        return text

    def _build_markitdown(self, provider: ProviderSnapshot | None) -> MarkItDown:
        if provider is None:
            return MarkItDown(enable_plugins=False)

        settings = get_settings()
        client = OpenAI(
            api_key=provider.api_key,
            base_url=provider.base_url,
            timeout=settings.llm_timeout_seconds,
        )
        return MarkItDown(
            enable_plugins=False,
            llm_client=_VisionCaptionClient(
                client,
                max_tokens=settings.attachment_vision_max_tokens,
            ),
            llm_model=provider.model,
            llm_prompt=(
                "Describe this image in detail for a document assistant. "
                "Write in the same language as any visible text in the image."
            ),
        )

    @staticmethod
    def _fallback_markdown(
        *,
        filename: str,
        mime_type: str,
        size: int,
        note: str | None = None,
    ) -> str:
        lines = [
            f"# {filename}",
            "",
            f"- MIME type: `{mime_type}`",
            f"- Size: {size} bytes",
        ]
        if mime_type.startswith("image/"):
            lines.extend(
                [
                    "",
                    "No EXIF metadata or vision caption was produced for this image.",
                    "Use a vision-capable model provider with sufficient credits.",
                ]
            )
        elif mime_type.startswith(("audio/", "video/")):
            lines.extend(
                [
                    "",
                    "No speech transcript or media metadata was extracted.",
                    "Install `exiftool` locally or use a provider that supports transcription.",
                ]
            )
        else:
            lines.append("")
            lines.append("No extractable text was produced from this file.")
        if note:
            lines.extend(["", f"Vision caption error: {note}"])
        return "\n".join(lines)

    def _convert_sync(
        self,
        filename: str,
        mime_type: str,
        content: bytes,
        provider: ProviderSnapshot | None,
    ) -> str:
        converter = self._build_markitdown(provider)
        result = converter.convert_stream(
            BytesIO(content),
            stream_info=StreamInfo(
                filename=filename,
                extension=Path(filename).suffix or None,
                mimetype=mime_type or None,
            ),
        )
        return result.text_content
