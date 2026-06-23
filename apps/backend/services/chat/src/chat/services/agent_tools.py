"""Function tools exposed to the conversation agent runtime."""

from __future__ import annotations

import base64
import html as html_lib
import json
import re
from collections.abc import Sequence
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
from chat.services.model_limits import bounded_extra_body_and_max_tokens
from chat.services.storage_client import StorageClient

_MAX_DOCUMENT_READ_CHARS = 6_000
_MAX_SEARCH_RESULTS = 8
_MAX_SNIPPET_CHARS = 500
_MAX_WEB_SEARCH_RESULTS = 5
_MAX_WEB_SNIPPET_CHARS = 300
_WEB_SEARCH_TIMEOUT_SECONDS = 10.0
_DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/"


class AgentToolContext(Protocol):
    session: AsyncSession
    current_user: AuthContext
    conversation_id: str
    documents: dict[str, ConversationDocumentRow]
    messages: list[MessageRow]
    multimodal_provider: ProviderSnapshot | None
    created_documents: list[ConversationDocumentRow]

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
                headers={"User-Agent": "ProjectMonorepoAgent/0.1"},
            )
            response.raise_for_status()

        results = _parse_web_search_results(response.text, limit)
        if results:
            output = "\n".join(
                f"{index}. {item['title']}\n   {item['url']}\n   {item['snippet']}"
                for index, item in enumerate(results, start=1)
            )
        else:
            output = "No web search results."
        return output
    except Exception as exc:
        return _tool_error("web_search", exc)


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
                "name": "web_search",
                "description": "Search the public web and return compact result titles, URLs, and snippets.",
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
        return f"Tool error in {tool_name}: invalid JSON arguments: {exc}"
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


def _parse_web_search_results(raw: str, limit: int) -> list[dict[str, str]]:
    anchors = list(
        re.finditer(
            r'(?is)<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
            raw,
        )
    )
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
