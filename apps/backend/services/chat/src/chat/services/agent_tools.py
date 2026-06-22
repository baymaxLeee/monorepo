"""Function tools exposed to the conversation agent runtime."""

from __future__ import annotations

import asyncio
import html as html_lib
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from agents import RunContextWrapper, function_tool
from kernel.errors import RequestError
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from chat.deps import AuthContext
from chat.models.document import ConversationDocumentRow
from chat.models.message import MessageRow
from chat.services.documents import ConversationDocumentService

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
    created_documents: list[ConversationDocumentRow]
    tool_write_lock: asyncio.Lock

    def get_document(self, document_id: str) -> ConversationDocumentRow: ...


class ArtifactWriteInput(BaseModel):
    title: str = Field(description="Human-readable artifact title.")
    filename: str = Field(description="Output filename, preferably ending in .md or .html.")
    content_markdown: str = Field(description="Complete artifact content. For HTML, pass raw complete HTML.")


@function_tool
def list_conversation_documents(ctx: RunContextWrapper[AgentToolContext]) -> str:
    """List Markdown or HTML documents available in this conversation."""

    rows = _document_rows(ctx.context)
    if rows:
        output = "\n".join(
            f"- {row.id}: {row.title} ({row.kind}, {row.filename}, {row.mime_type})" for row in rows
        )
    else:
        output = "No conversation documents."
    return output


@function_tool
def read_document_markdown(
    ctx: RunContextWrapper[AgentToolContext],
    document_id: str,
) -> str:
    """Read a conversation document's stored content.

    Args:
        document_id: Document ID from list_conversation_documents.
    """

    row = ctx.context.get_document(document_id)
    output = row.content_md
    return output


@function_tool
def search_conversation(
    ctx: RunContextWrapper[AgentToolContext],
    query: str,
    max_results: int = 5,
) -> str:
    """Search the current conversation history and document contents.

    Args:
        query: Text to search for.
        max_results: Maximum number of matches to return.
    """

    terms = [term.casefold() for term in re.findall(r"[\w\u4e00-\u9fff]+", query) if term.strip()]
    if not terms:
        raise RequestError("search query is required")
    limit = max(1, min(max_results, _MAX_SEARCH_RESULTS))
    results: list[str] = []

    for index, message in enumerate(ctx.context.messages, start=1):
        haystack = f"{message.role}\n{message.status}\n{message.content}"
        snippet = _match_snippet(haystack, terms)
        if snippet:
            results.append(f"- message:{index} role={message.role} status={message.status}\n  {snippet}")
            if len(results) >= limit:
                break

    if len(results) < limit:
        for row in _document_rows(ctx.context):
            haystack = f"{row.title}\n{row.filename}\n{row.kind}\n{row.content_md}"
            snippet = _match_snippet(haystack, terms)
            if snippet:
                results.append(f"- document:{row.id} title={row.title} filename={row.filename}\n  {snippet}")
                if len(results) >= limit:
                    break

    output = "\n".join(results) if results else "No matches in the current conversation."
    return output


@function_tool(timeout=30.0)
async def write_artifacts(
    ctx: RunContextWrapper[AgentToolContext],
    artifacts: list[ArtifactWriteInput],
) -> str:
    """Create multiple artifact files in the current conversation with one tool call.

    Use this single batch tool when the user asks for one or more files, such
    as a Markdown summary and an HTML demo.

    Args:
        artifacts: Files to create.
    """

    if not artifacts:
        raise RequestError("at least one artifact is required")
    if len(artifacts) > 5:
        raise RequestError("too many artifacts in one request", details={"max_artifacts": 5})
    created: list[ConversationDocumentRow] = []
    for artifact in artifacts:
        row = await _create_artifact(
            ctx.context,
            title=artifact.title,
            filename=artifact.filename,
            content_markdown=artifact.content_markdown,
        )
        ctx.context.created_documents.append(row)
        created.append(row)
    output = "\n".join(f"Created artifact {row.id}: {row.title} ({row.filename}, {row.mime_type})" for row in created)
    return output


@function_tool(timeout=15.0)
async def web_search(
    ctx: RunContextWrapper[AgentToolContext],
    query: str,
    max_results: int = 5,
) -> str:
    """Search the public web and return compact result titles, URLs, and snippets.

    Args:
        query: Search keywords.
        max_results: Maximum number of search results to return.
    """

    search_query = query.strip()
    if not search_query:
        raise RequestError("web search query is required")
    limit = max(1, min(max_results, _MAX_WEB_SEARCH_RESULTS))
    try:
        async with httpx.AsyncClient(timeout=_WEB_SEARCH_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = await client.get(
                _DUCKDUCKGO_HTML_URL,
                params={"q": search_query},
                headers={"User-Agent": "ProjectMonorepoAgent/0.1"},
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise RequestError("web search failed", details={"reason": str(exc)}) from exc

    results = _parse_web_search_results(response.text, limit)
    if results:
        output = "\n".join(
            f"{index}. {item['title']}\n   {item['url']}\n   {item['snippet']}"
            for index, item in enumerate(results, start=1)
        )
    else:
        output = "No web search results."
    return output


def agent_runtime_tools() -> list[Any]:
    return [
        list_conversation_documents,
        read_document_markdown,
        search_conversation,
        web_search,
        write_artifacts,
    ]


def _document_rows(context: AgentToolContext) -> list[ConversationDocumentRow]:
    return list(context.documents.values()) + context.created_documents


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


def _safe_artifact_filename(filename: str) -> str:
    safe = Path(filename).name.strip() or "artifact.md"
    if "." not in safe:
        safe = f"{safe}.md"
    return safe


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
    content_markdown: str,
) -> ConversationDocumentRow:
    safe_filename = _safe_artifact_filename(filename or title)
    content = content_markdown.strip()
    async with context.tool_write_lock:
        return await ConversationDocumentService(context.session, context.current_user).create_artifact_row(
            conversation_id=context.conversation_id,
            kind="artifact",
            title=title,
            filename=safe_filename,
            mime_type=_artifact_mime_type(safe_filename, content),
            content_md=content,
        )


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
