"""Function tools exposed to the conversation agent runtime."""

from __future__ import annotations

import base64
import html as html_lib
import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Protocol, cast
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from chat.config import get_settings
from chat.deps import AuthContext
from chat.models.document import ConversationDocumentRow
from chat.models.message import MessageRow
from chat.services.admin_client import ProviderSnapshot
from chat.services.documents import ConversationDocumentService
from chat.services.model_limits import bounded_extra_body_and_max_tokens
from chat.services.storage_client import StorageClient

_ARTIFACT_TITLE_MAX_CHARS = 120
_ARTIFACT_FILENAME_MAX_CHARS = 160
_ARTIFACT_APPEND_MAX_CHARS = 8_000
_ARTIFACT_WRITE_TOOL_NAMES = frozenset({"write_artifacts", "write_artifact", "finish_artifact"})
_ARTIFACT_CHUNK_TOOL_NAMES = frozenset({"start_artifact", "append_artifact"})
_ARTIFACT_TOOL_NAMES = _ARTIFACT_WRITE_TOOL_NAMES | _ARTIFACT_CHUNK_TOOL_NAMES
_MAX_DOCUMENT_READ_CHARS = 6_000
_MAX_SEARCH_RESULTS = 8
_MAX_SNIPPET_CHARS = 500
_MAX_WEB_SEARCH_RESULTS = 5
_MAX_WEB_SNIPPET_CHARS = 300
_WEB_SEARCH_TIMEOUT_SECONDS = 10.0
_DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/"
_WEB_SEARCH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
_WEB_SEARCH_BLOCKED_MARKERS = ("anomaly-modal", "bots use duckduckgo")
_WEB_SEARCH_NO_RETRY_HINT = " Do not call web_search again in this run."
_RESULT_ANCHOR_PATTERNS = (
    r'(?is)<a\b[^>]*\bclass="[^"]*result__a[^"]*"[^>]*\bhref="([^"]+)"[^>]*>(.*?)</a>',
    r'(?is)<a\b[^>]*\bhref="([^"]+)"[^>]*\bclass="[^"]*result__a[^"]*"[^>]*>(.*?)</a>',
)


class AgentToolContext(Protocol):
    session: AsyncSession
    current_user: AuthContext
    conversation_id: str
    documents: dict[str, ConversationDocumentRow]
    messages: list[MessageRow]
    multimodal_provider: ProviderSnapshot | None
    created_documents: list[ConversationDocumentRow]
    pending_artifacts: dict[str, dict[str, Any]]

    def get_document(self, document_id: str) -> ConversationDocumentRow: ...


def list_conversation_documents_direct(context: AgentToolContext) -> str:
    rows = _document_rows(context)
    if rows:
        output = "\n".join(
            f"- {row.id}: {row.title} ({row.kind}, {row.filename}, {row.mime_type}, source={row.source_mime_type or 'none'})"
            for row in rows
        )
    else:
        output = "No conversation documents."
    return output


def read_document_markdown_direct(
    context: AgentToolContext,
    *,
    document_id: str,
    start: int = 0,
    max_chars: int = 4_000,
) -> str:
    try:
        row = context.get_document(document_id)
        safe_start = max(0, start)
        safe_limit = max(1, min(max_chars, _MAX_DOCUMENT_READ_CHARS))
        content = row.content_md
        chunk = content[safe_start : safe_start + safe_limit]
        next_offset = safe_start + len(chunk)
        suffix = ""
        if next_offset < len(content):
            suffix = f"\n\n[truncated; next start={next_offset}; total chars={len(content)}]"
        return chunk + suffix
    except Exception as exc:
        return _tool_error("read_document_markdown", exc)


async def analyze_image_direct(
    context: AgentToolContext,
    *,
    document_id: str,
    question: str,
) -> str:
    try:
        provider = context.multimodal_provider
        if provider is None:
            return "Tool error in analyze_image: multimodal provider is not configured"

        row = context.get_document(document_id)
        mime_type = row.source_mime_type or row.mime_type
        if not mime_type.lower().startswith("image/") or not row.source_object_bucket or not row.source_object_key:
            return f"Tool error in analyze_image: document has no original image payload (document_id={document_id}, mime_type={mime_type})"
        image_bytes = await StorageClient().get_bytes(
            bucket=row.source_object_bucket,
            key=row.source_object_key,
        )
        image_b64 = base64.b64encode(image_bytes).decode("ascii")

        settings = get_settings()
        extra_body, max_tokens = bounded_extra_body_and_max_tokens(
            provider.extra_body,
            default_max_tokens=settings.agent_max_output_tokens,
        )
        client = AsyncOpenAI(
            api_key=provider.api_key,
            base_url=provider.base_url,
            timeout=settings.llm_timeout_seconds,
        )
        data_url = f"data:{mime_type};base64,{image_b64}"
        prompt = question.strip() or "Describe this image."
        last_error: Exception | None = None
        try:
            for content in _vision_content_variants(prompt, data_url, mime_type, image_b64):
                try:
                    response = await client.chat.completions.create(
                        model=provider.model,
                        messages=cast(Any, [
                            {
                                "role": "system",
                                "content": (
                                    "You are a precise visual analyst. Return concise text with visible objects, "
                                    "visible text, important details, and conclusions relevant to the user's question."
                                ),
                            },
                            {
                                "role": "user",
                                "content": content,
                            },
                        ]),
                        max_tokens=max_tokens,
                        extra_body=extra_body or None,
                    )
                    if not response.choices:
                        return "No image analysis result."
                    return (response.choices[0].message.content or "").strip() or "No image analysis result."
                except Exception as exc:
                    last_error = exc
                    if not _is_vision_format_error(exc):
                        return _tool_error("analyze_image", exc)
        finally:
            await client.close()

        return f"Tool error in analyze_image: image analysis failed ({last_error})"
    except Exception as exc:
        return _tool_error("analyze_image", exc)


async def perform_web_search(query: str, *, max_results: int = 5) -> str:
    try:
        search_query = query.strip()
        if not search_query:
            return "Tool error in web_search: web search query is required"
        limit = max(1, min(max_results, _MAX_WEB_SEARCH_RESULTS))
        async with httpx.AsyncClient(timeout=_WEB_SEARCH_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = await client.get(
                _DUCKDUCKGO_HTML_URL,
                params={"q": search_query},
                headers=_WEB_SEARCH_HEADERS,
            )

        if _is_web_search_blocked(response.status_code, response.text):
            return (
                "Tool error in web_search: search provider blocked this request (bot detection)."
                + _WEB_SEARCH_NO_RETRY_HINT
            )
        if response.status_code >= 400:
            return (
                f"Tool error in web_search: upstream HTTP {response.status_code}."
                + _WEB_SEARCH_NO_RETRY_HINT
            )

        results = _parse_web_search_results(response.text, limit)
        if results:
            return "\n".join(
                f"{index}. {item['title']}\n   {item['url']}\n   {item['snippet']}"
                for index, item in enumerate(results, start=1)
            )
        return (
            f"Tool error in web_search: no results parsed for query {search_query!r}."
            + _WEB_SEARCH_NO_RETRY_HINT
        )
    except Exception as exc:
        return _tool_error("web_search", exc) + _WEB_SEARCH_NO_RETRY_HINT


async def write_artifacts_direct(
    context: AgentToolContext,
    *,
    artifacts: Sequence[dict[str, Any]],
    allow_plain_html: bool = False,
) -> str:
    try:
        if not artifacts:
            return "Tool error in write_artifacts: at least one artifact is required"
        settings = get_settings()
        if len(artifacts) > settings.agent_artifact_max_files:
            return (
                "Tool error in write_artifacts: too many artifacts in one request "
                f"(max {settings.agent_artifact_max_files})"
            )

        normalized: list[tuple[str, str, str]] = []
        total_chars = 0
        for index, artifact in enumerate(artifacts, start=1):
            if not isinstance(artifact, dict):
                return f"Tool error in write_artifacts: artifact #{index} must be an object"
            payload = _normalize_artifact_payload(
                artifact,
                index=index,
                allow_plain_html=allow_plain_html,
            )
            if isinstance(payload, str):
                return payload
            title, filename, content = payload
            if len(content) > settings.agent_artifact_max_chars:
                return (
                    f"Tool error in write_artifacts: artifact #{index} content exceeds "
                    f"{settings.agent_artifact_max_chars} chars; use start_artifact/append_artifact/finish_artifact"
                )
            total_chars += len(content)
            normalized.append((title, filename, content))

        if total_chars > settings.agent_artifact_total_max_chars:
            return (
                "Tool error in write_artifacts: artifact batch exceeds "
                f"{settings.agent_artifact_total_max_chars} chars; use chunked artifact tools"
            )

        created: list[ConversationDocumentRow] = []
        for title, filename, content in normalized:
            row = await _create_artifact(
                context,
                title=title,
                filename=filename,
                content=content,
            )
            context.created_documents.append(row)
            created.append(row)

        return "\n".join(
            f"Created artifact {row.id}: {row.title} ({row.filename}, {row.mime_type})"
            for row in created
        )
    except Exception as exc:
        return _tool_error("write_artifacts", exc)


def start_artifact_direct(context: AgentToolContext, *, title: str, filename: str) -> str:
    safe_title = title.strip()
    safe_filename = filename.strip()
    if not safe_title:
        return "Tool error in start_artifact: title is required"
    if not safe_filename:
        return "Tool error in start_artifact: filename is required"
    handle = f"pending-{len(context.pending_artifacts)}"
    context.pending_artifacts[handle] = {
        "title": safe_title[:_ARTIFACT_TITLE_MAX_CHARS],
        "filename": safe_filename[:_ARTIFACT_FILENAME_MAX_CHARS],
        "parts": [],
    }
    return (
        f"Started artifact {handle} for {safe_filename}. "
        "Call append_artifact one or more times, then finish_artifact."
    )


def append_artifact_direct(
    context: AgentToolContext,
    *,
    handle: str,
    content: str = "",
    content_base64: str = "",
) -> str:
    pending = context.pending_artifacts.get(handle.strip())
    if pending is None:
        return f"Tool error in append_artifact: unknown handle {handle!r}"
    try:
        chunk = _decode_artifact_content(
            content=content,
            content_base64=content_base64,
        )
    except ValueError as exc:
        return f"Tool error in append_artifact: {exc}"
    if len(chunk) > _ARTIFACT_APPEND_MAX_CHARS:
        return (
            f"Tool error in append_artifact: chunk exceeds {_ARTIFACT_APPEND_MAX_CHARS} chars; "
            "split into smaller append_artifact calls"
        )
    parts = pending["parts"]
    if not isinstance(parts, list):
        return f"Tool error in append_artifact: invalid pending state for {handle!r}"
    parts.append(chunk)
    total_chars = sum(len(part) for part in parts)
    return f"Appended {len(chunk)} chars to {handle} (total {total_chars})."


async def finish_artifact_direct(context: AgentToolContext, *, handle: str) -> str:
    pending = context.pending_artifacts.pop(handle.strip(), None)
    if pending is None:
        return f"Tool error in finish_artifact: unknown handle {handle!r}"
    parts = pending.get("parts")
    if not isinstance(parts, list) or not parts:
        return f"Tool error in finish_artifact: {handle!r} has no content; call append_artifact first"
    return await write_artifacts_direct(
        context,
        artifacts=[
            {
                "title": str(pending.get("title") or "Artifact"),
                "filename": str(pending.get("filename") or "artifact.md"),
                "content": "".join(str(part) for part in parts),
            }
        ],
        allow_plain_html=True,
    )


def is_artifact_write_tool(tool_name: str) -> bool:
    return tool_name in _ARTIFACT_TOOL_NAMES


def is_successful_artifact_write(tool_name: str, output: str) -> bool:
    return is_artifact_write_tool(tool_name) and output.startswith("Created artifact")


def agent_runtime_tool_specs() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "list_conversation_documents",
                "description": "List Markdown or HTML documents available in this conversation.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_document_markdown",
                "description": "Read a bounded slice of a conversation document's stored content.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "document_id": {"type": "string"},
                        "start": {"type": "integer", "default": 0},
                        "max_chars": {"type": "integer", "default": 4000},
                    },
                    "required": ["document_id"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "analyze_image",
                "description": "Analyze an uploaded image document with the configured multimodal provider.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "document_id": {"type": "string"},
                        "question": {"type": "string", "default": "Describe this image in detail for the current user request."},
                    },
                    "required": ["document_id"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "start_artifact",
                "description": (
                    "Begin a large Markdown or HTML file write. Returns a handle for append_artifact/finish_artifact. "
                    "Use this for .html files or any content that may break JSON tool arguments."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "filename": {"type": "string", "description": "Output filename, e.g. index.html or readme.md"},
                    },
                    "required": ["title", "filename"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "append_artifact",
                "description": (
                    "Append the next chunk to a pending artifact started with start_artifact. "
                    "Prefer content_base64 for HTML chunks. Keep each chunk under 8000 chars."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "handle": {"type": "string"},
                        "content": {"type": "string", "description": "Plain-text chunk. Avoid for HTML."},
                        "content_base64": {
                            "type": "string",
                            "description": "Base64-encoded UTF-8 chunk. Preferred for HTML.",
                        },
                    },
                    "required": ["handle"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "finish_artifact",
                "description": "Finalize a pending artifact started with start_artifact and save it to the conversation.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "handle": {"type": "string"},
                    },
                    "required": ["handle"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write_artifacts",
                "description": (
                    "Create one or more small Markdown files in a single call. "
                    "For .html or large/complex content, use start_artifact + append_artifact + finish_artifact instead."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "artifacts": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {
                                        "type": "string",
                                        "description": "Human-readable title shown in the conversation document list.",
                                    },
                                    "filename": {
                                        "type": "string",
                                        "description": "Output filename, preferably ending in .md or .html.",
                                    },
                                    "content": {
                                        "type": "string",
                                        "description": "Plain text content for short Markdown only.",
                                    },
                                    "content_base64": {
                                        "type": "string",
                                        "description": (
                                            "Base64-encoded UTF-8 file content. "
                                            "Required for .html and any content with quotes or newlines."
                                        ),
                                    },
                                },
                                "required": ["title", "filename"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["artifacts"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": (
                    "Search the public web and return compact result titles, URLs, and snippets. "
                    "Call at most once per run; if it errors, answer from existing knowledge without retrying."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "max_results": {"type": "integer", "default": 5},
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                },
            },
        },
    ]


async def execute_agent_runtime_tool(context: AgentToolContext, tool_name: str, raw_arguments: str) -> str:
    try:
        args = json.loads(raw_arguments or "{}")
    except json.JSONDecodeError as exc:
        if tool_name in _ARTIFACT_WRITE_TOOL_NAMES:
            salvaged = _salvage_write_artifacts_arguments(raw_arguments)
            if salvaged is not None:
                return await write_artifacts_direct(context, artifacts=salvaged)
        return (
            f"Tool error in {tool_name}: invalid JSON arguments: {exc}. "
            "For HTML or large files use start_artifact + append_artifact(content_base64) + finish_artifact."
        )
    if not isinstance(args, dict):
        return f"Tool error in {tool_name}: arguments must be a JSON object"

    if tool_name == "list_conversation_documents":
        return list_conversation_documents_direct(context)

    if tool_name == "read_document_markdown":
        return read_document_markdown_direct(
            context,
            document_id=str(args.get("document_id") or ""),
            start=int(args.get("start") or 0),
            max_chars=int(args.get("max_chars") or 4000),
        )

    if tool_name == "analyze_image":
        return await analyze_image_direct(
            context,
            document_id=str(args.get("document_id") or ""),
            question=str(args.get("question") or "Describe this image in detail for the current user request."),
        )

    if tool_name == "start_artifact":
        return start_artifact_direct(
            context,
            title=str(args.get("title") or ""),
            filename=str(args.get("filename") or ""),
        )

    if tool_name == "append_artifact":
        return append_artifact_direct(
            context,
            handle=str(args.get("handle") or ""),
            content=str(args.get("content") or ""),
            content_base64=str(args.get("content_base64") or ""),
        )

    if tool_name == "finish_artifact":
        return await finish_artifact_direct(context, handle=str(args.get("handle") or ""))

    if tool_name in _ARTIFACT_WRITE_TOOL_NAMES:
        raw_artifacts = args.get("artifacts")
        if not isinstance(raw_artifacts, list):
            return "Tool error in write_artifacts: artifacts must be a JSON array"
        return await write_artifacts_direct(context, artifacts=raw_artifacts)

    if tool_name == "web_search":
        return await perform_web_search(
            str(args.get("query") or ""),
            max_results=int(args.get("max_results") or 5),
        )

    return f"Tool error: unknown tool {tool_name}"


def _vision_content_variants(prompt: str, data_url: str, mime_type: str, data_b64: str) -> list[list[dict[str, Any]]]:
    return [
        [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": data_url}},
        ],
        [
            {"type": "text", "text": prompt},
            {"type": "input_image", "image_url": data_url},
        ],
        [
            {"type": "text", "text": prompt},
            {"type": "image", "image": data_url},
        ],
        [
            {"type": "text", "text": prompt},
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime_type,
                    "data": data_b64,
                },
            },
        ],
    ]


def _is_vision_format_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        marker in text
        for marker in (
            "unknown variant",
            "image_url",
            "input_image",
            "failed to deserialize",
            "invalid type",
            "invalid_request_error",
            "badrequest",
        )
    )


def _document_rows(context: AgentToolContext) -> list[ConversationDocumentRow]:
    return list(context.documents.values()) + context.created_documents


def _tool_error(tool_name: str, exc: Exception) -> str:
    return f"Tool error in {tool_name}: {exc}"


def _decode_artifact_content(
    *,
    content: str = "",
    content_markdown: str = "",
    content_base64: str = "",
) -> str:
    encoded = content_base64.strip()
    if encoded:
        padding = "=" * (-len(encoded) % 4)
        try:
            return base64.b64decode(encoded + padding, validate=False).decode("utf-8")
        except Exception as exc:
            raise ValueError(f"invalid content_base64: {exc}") from exc
    text = str(content or content_markdown or "").strip()
    if not text:
        raise ValueError("content or content_base64 is required")
    return text


def _normalize_artifact_payload(
    artifact: dict[str, Any],
    *,
    index: int,
    allow_plain_html: bool = False,
) -> tuple[str, str, str] | str:
    title = str(artifact.get("title") or "").strip()
    filename = str(artifact.get("filename") or "").strip()
    if not title:
        return f"Tool error in write_artifacts: artifact #{index} title is required"
    if not filename:
        return f"Tool error in write_artifacts: artifact #{index} filename is required"
    if len(title) > _ARTIFACT_TITLE_MAX_CHARS:
        return (
            f"Tool error in write_artifacts: artifact #{index} title exceeds "
            f"{_ARTIFACT_TITLE_MAX_CHARS} chars"
        )
    if len(filename) > _ARTIFACT_FILENAME_MAX_CHARS:
        return (
            f"Tool error in write_artifacts: artifact #{index} filename exceeds "
            f"{_ARTIFACT_FILENAME_MAX_CHARS} chars"
        )
    has_base64 = bool(str(artifact.get("content_base64") or "").strip())
    has_plain = bool(str(artifact.get("content") or artifact.get("content_markdown") or "").strip())
    lowered = filename.casefold()
    if lowered.endswith((".html", ".htm")) and not has_base64 and not allow_plain_html:
        return (
            f"Tool error in write_artifacts: artifact #{index} HTML must use content_base64 "
            "or start_artifact/append_artifact/finish_artifact"
        )
    if not has_base64 and not has_plain:
        return f"Tool error in write_artifacts: artifact #{index} content or content_base64 is required"
    try:
        content = _decode_artifact_content(
            content=str(artifact.get("content") or ""),
            content_markdown=str(artifact.get("content_markdown") or ""),
            content_base64=str(artifact.get("content_base64") or ""),
        )
    except ValueError as exc:
        return f"Tool error in write_artifacts: artifact #{index} {exc}"
    return title, filename, content


def _salvage_write_artifacts_arguments(raw_arguments: str) -> list[dict[str, Any]] | None:
    raw = raw_arguments.strip()
    if not raw:
        return None

    for suffix in ('"}]}', '"]}', '"}', '"}]'):
        try:
            parsed = json.loads(raw + suffix)
        except json.JSONDecodeError:
            continue
        artifacts = parsed.get("artifacts") if isinstance(parsed, dict) else None
        if isinstance(artifacts, list) and artifacts:
            return artifacts

    title_match = re.search(r'"title"\s*:\s*"((?:\\.|[^"\\])*)"', raw)
    filename_match = re.search(r'"filename"\s*:\s*"((?:\\.|[^"\\])*)"', raw)
    base64_match = re.search(r'"content_base64"\s*:\s*"([A-Za-z0-9+/=\r\n]+)', raw)
    if title_match and filename_match and base64_match:
        return [
            {
                "title": json.loads(f'"{title_match.group(1)}"'),
                "filename": json.loads(f'"{filename_match.group(1)}"'),
                "content_base64": base64_match.group(1),
            }
        ]
    return None


def _safe_artifact_filename(filename: str) -> str:
    safe = Path(filename).name.strip() or "artifact.md"
    if "." not in safe:
        safe = f"{safe}.md"
    return safe[:160]


def _artifact_mime_type(filename: str, content: str) -> str:
    lowered = filename.lower()
    if lowered.endswith((".html", ".htm")) or content.lower().lstrip().startswith(("<!doctype html", "<html")):
        return "text/html"
    return "text/markdown"


async def _create_artifact(
    context: AgentToolContext,
    *,
    title: str,
    filename: str,
    content: str,
) -> ConversationDocumentRow:
    safe_filename = _safe_artifact_filename(filename or title)
    return await ConversationDocumentService(context.session, context.current_user).create_artifact_row(
        conversation_id=context.conversation_id,
        kind="artifact",
        title=title.strip()[:_ARTIFACT_TITLE_MAX_CHARS],
        filename=safe_filename,
        mime_type=_artifact_mime_type(safe_filename, content),
        content_md=content.strip(),
    )


def _match_snippet(text: str, terms: Sequence[str]) -> str | None:
    folded = text.casefold()
    positions = [folded.find(term) for term in terms]
    positions = [position for position in positions if position >= 0]
    if not positions:
        return None
    start = max(0, min(positions) - 120)
    end = min(len(text), start + _MAX_SNIPPET_CHARS)
    snippet = re.sub(r"\s+", " ", text[start:end]).strip()
    return snippet


def _is_web_search_blocked(status_code: int, html: str) -> bool:
    if status_code == 202:
        return True
    lowered = html.casefold()
    return any(marker in lowered for marker in _WEB_SEARCH_BLOCKED_MARKERS)


def _parse_web_search_results(raw: str, limit: int) -> list[dict[str, str]]:
    anchors: list[re.Match[str]] = []
    seen_positions: set[int] = set()
    for pattern in _RESULT_ANCHOR_PATTERNS:
        for anchor in re.finditer(pattern, raw):
            if anchor.start() in seen_positions:
                continue
            seen_positions.add(anchor.start())
            anchors.append(anchor)
    anchors.sort(key=lambda match: match.start())
    results: list[dict[str, str]] = []
    for index, anchor in enumerate(anchors):
        block_end = anchors[index + 1].start() if index + 1 < len(anchors) else len(raw)
        block = raw[anchor.start() : block_end]
        title = _clean_search_html(anchor.group(2))
        url = _normalize_result_url(anchor.group(1))
        snippet = _extract_search_snippet(block)
        if not title or not url:
            continue
        results.append(
            {
                "title": title,
                "url": url,
                "snippet": snippet[:_MAX_WEB_SNIPPET_CHARS] or "No snippet.",
            }
        )
        if len(results) >= limit:
            break
    return results


def _extract_search_snippet(block: str) -> str:
    match = re.search(
        r'(?is)<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</(?:a|div)>',
        block,
    )
    return _clean_search_html(match.group(1)) if match else ""


def _clean_search_html(raw: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", raw)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _normalize_result_url(raw_url: str) -> str:
    url = html_lib.unescape(raw_url)
    if url.startswith("//"):
        url = f"https:{url}"
    parsed = urlparse(url)
    redirect_target = parse_qs(parsed.query).get("uddg")
    if redirect_target:
        return unquote(redirect_target[0])
    if parsed.scheme in {"http", "https"}:
        return url
    if url.startswith("/"):
        return f"https://duckduckgo.com{url}"
    return url
