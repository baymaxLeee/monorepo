"""MarkItDown document conversion."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Any

import anyio
from kernel.errors import BaseError, RequestError
from knowledge.config import get_settings
from markitdown import MarkItDown, StreamInfo
from openai import OpenAI

if TYPE_CHECKING:
    from knowledge.services.admin_client import ProviderSnapshot


class AttachmentTooLargeError(BaseError):
    status_code = 413
    code = "attachment_too_large"


class AttachmentConversionError(BaseError):
    status_code = 422
    code = "attachment_conversion_failed"


class _BoundedCompletions:
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
    def __init__(self, client: OpenAI, *, max_tokens: int) -> None:
        self._client = client
        self._max_tokens = max_tokens

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)

    @property
    def chat(self) -> _BoundedChat:
        return _BoundedChat(self._client.chat, self._max_tokens)


class ConvertService:
    async def convert(
        self,
        *,
        filename: str,
        mime_type: str,
        content: bytes,
        provider: ProviderSnapshot | None = None,
    ) -> str:
        settings = get_settings()
        if not filename.strip():
            raise RequestError("filename is required")
        if not content:
            raise RequestError("content is empty")
        if len(content) > settings.attachment_max_upload_bytes:
            raise AttachmentTooLargeError(
                "attachment too large",
                details={"max_bytes": settings.attachment_max_upload_bytes, "actual_bytes": len(content)},
            )

        vision_note: str | None = None
        try:
            markdown = await anyio.to_thread.run_sync(
                self._convert_sync, filename, mime_type, content, provider
            )
        except BaseError:
            raise
        except Exception as exc:
            if mime_type.lower().startswith(("image/", "audio/", "video/")):
                vision_note = str(exc)[:240]
                markdown = ""
            else:
                raise AttachmentConversionError(
                    "MarkItDown conversion failed",
                    details={"filename": filename, "reason": str(exc)},
                ) from exc

        markdown = markdown.strip()
        if not markdown:
            markdown = self._fallback_markdown(
                filename=filename, mime_type=mime_type, size=len(content), note=vision_note
            )

        max_chars = settings.attachment_markdown_max_chars
        if len(markdown) > max_chars:
            markdown = markdown[:max_chars].rstrip() + "\n\n...[truncated]"
        return markdown

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
            llm_client=_VisionCaptionClient(client, max_tokens=settings.attachment_vision_max_tokens),
            llm_model=provider.model,
            llm_prompt="Describe this image in detail for a document assistant.",
        )

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

    @staticmethod
    def _fallback_markdown(*, filename: str, mime_type: str, size: int, note: str | None) -> str:
        lines = [f"# {filename}", "", f"- MIME type: `{mime_type}`", f"- Size: {size} bytes"]
        if note:
            lines.extend(["", f"Note: {note}"])
        return "\n".join(lines)
