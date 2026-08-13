"""MarkItDown document conversion."""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    from application.admin_client import ProviderSnapshot

import anyio
from bootstrap.config import get_settings
from kernel.errors import BaseError, RequestError
from markitdown import MarkItDown, StreamInfo
from openai import OpenAI

IMAGE_INGEST_PROMPT = (
    "You are indexing an uploaded image for search and chat. "
    "Describe visible text, layout, charts, and key objects concisely in Markdown. "
    "Only describe what is visible; do not invent details."
)


class AttachmentTooLargeError(BaseError):
    status_code = 413
    code = "attachment_too_large"


class AttachmentConversionError(BaseError):
    status_code = 422
    code = "attachment_conversion_failed"


class _ResponsesCompletions:
    def __init__(self, client: OpenAI, max_tokens: int, extra_body: dict[str, Any] | None = None) -> None:
        self._client = client
        self._max_tokens = max_tokens
        self._extra_body = extra_body or None

    def create(self, *, model: str, messages: list[dict[str, Any]], **_: Any) -> Any:
        response = self._client.responses.create(
            model=model,
            input=cast(Any, _responses_input(messages)),
            max_output_tokens=self._max_tokens,
            extra_body=self._extra_body,
        )
        # MarkItDown 0.1.x hardcodes the Chat-shaped return at this external boundary.
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=response.output_text))])


class _ResponsesChat:
    def __init__(self, client: OpenAI, max_tokens: int, extra_body: dict[str, Any] | None = None) -> None:
        self._client = client
        self._max_tokens = max_tokens
        self._extra_body = extra_body or None

    @property
    def completions(self) -> _ResponsesCompletions:
        return _ResponsesCompletions(self._client, self._max_tokens, self._extra_body)


class _VisionCaptionClient:
    def __init__(self, client: OpenAI, *, max_tokens: int, extra_body: dict[str, Any] | None = None) -> None:
        self._client = client
        self._max_tokens = max_tokens
        self._extra_body = extra_body or None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)

    @property
    def chat(self) -> _ResponsesChat:
        return _ResponsesChat(self._client, self._max_tokens, self._extra_body)


def _responses_input(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            result.append({"role": message.get("role", "user"), "content": str(content or "")})
            continue
        parts: list[dict[str, Any]] = []
        for part in content:
            if part.get("type") == "text":
                parts.append({"type": "input_text", "text": part.get("text", "")})
            elif part.get("type") == "image_url":
                image = part.get("image_url") or {}
                parts.append({"type": "input_image", "image_url": image.get("url", "")})
        result.append({"role": message.get("role", "user"), "content": parts})
    return result


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
        lowered_mime = mime_type.lower()
        try:
            if lowered_mime.startswith("image/"):
                if provider is None:
                    vision_note = "no vision provider configured for image ingest"
                    markdown = ""
                elif not provider.supports_image_input:
                    # Non-vision chat models 400 on image input (Ark et al.).
                    vision_note = f"provider '{provider.name}' does not support image input; caption skipped"
                    markdown = ""
                else:
                    markdown = await anyio.to_thread.run_sync(
                        self._convert_image_sync, filename, mime_type, content, provider
                    )
            else:
                markdown = await anyio.to_thread.run_sync(self._convert_sync, filename, mime_type, content, provider)
        except BaseError:
            raise
        except Exception as exc:
            if lowered_mime.startswith(("image/", "audio/", "video/")):
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
            llm_client=_VisionCaptionClient(
                client,
                max_tokens=settings.attachment_vision_max_tokens,
                extra_body=provider.extra_body,
            ),
            llm_model=provider.model,
            llm_prompt=IMAGE_INGEST_PROMPT,
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

    def _convert_image_sync(
        self,
        _filename: str,
        mime_type: str,
        content: bytes,
        provider: ProviderSnapshot,
    ) -> str:
        description = self._describe_image_sync(
            content=content,
            mime_type=mime_type,
            provider=provider,
        )
        if description:
            return f"# Description:\n{description}"
        return ""

    def _describe_image_sync(
        self,
        *,
        content: bytes,
        mime_type: str,
        provider: ProviderSnapshot,
    ) -> str:
        settings = get_settings()
        client = OpenAI(
            api_key=provider.api_key,
            base_url=provider.base_url,
            timeout=settings.llm_timeout_seconds,
        )
        normalized_mime = (mime_type.split(";")[0] or "application/octet-stream").strip().lower()
        data_uri = f"data:{normalized_mime};base64,{base64.b64encode(content).decode('utf-8')}"
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": IMAGE_INGEST_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_uri}},
                ],
            }
        ]
        response = client.responses.create(
            model=provider.model,
            input=cast(Any, _responses_input(messages)),
            max_output_tokens=settings.attachment_vision_max_tokens,
            extra_body=provider.extra_body or None,
        )
        return response.output_text.strip()

    @staticmethod
    def _fallback_markdown(*, filename: str, mime_type: str, size: int, note: str | None) -> str:
        lines = [f"# {filename}", "", f"- MIME type: `{mime_type}`", f"- Size: {size} bytes"]
        if note:
            lines.extend(["", f"Note: {note}"])
        return "\n".join(lines)
