"""Function tools exposed to the conversation agent runtime."""

from __future__ import annotations

import ast
import asyncio
import ipaddress
import re
import socket
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

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
_MAX_FETCH_CHARS = 20_000
_MAX_CODE_CHARS = 8_000
_MAX_CODE_OUTPUT_CHARS = 12_000
_FETCH_TIMEOUT_SECONDS = 10.0
_CODE_TIMEOUT_SECONDS = 8.0
_ALLOWED_CODE_IMPORTS = frozenset(
    {
        "collections",
        "datetime",
        "decimal",
        "fractions",
        "functools",
        "itertools",
        "json",
        "math",
        "random",
        "re",
        "statistics",
    }
)
_BLOCKED_CODE_NAMES = frozenset(
    {
        "__import__",
        "compile",
        "eval",
        "exec",
        "input",
        "open",
    }
)


class AgentToolContext(Protocol):
    session: AsyncSession
    current_user: AuthContext
    conversation_id: str
    documents: dict[str, ConversationDocumentRow]
    messages: list[MessageRow]
    created_documents: list[ConversationDocumentRow]
    tool_write_lock: asyncio.Lock

    def get_document(self, document_id: str) -> ConversationDocumentRow: ...

    def record_tool_call(self, name: str, input_text: str, output: str) -> None: ...


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
    ctx.context.record_tool_call("list_conversation_documents", "", output)
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
    ctx.context.record_tool_call("read_document_markdown", document_id, output)
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
    ctx.context.record_tool_call("search_conversation", query, output)
    return output


@function_tool
def list_workspace_files(ctx: RunContextWrapper[AgentToolContext]) -> str:
    """List files in the agent's conversation-scoped virtual workspace."""

    rows = _document_rows(ctx.context)
    output = "\n".join(
        f"- {row.filename} -> document_id={row.id} title={row.title} mime={row.mime_type}" for row in rows
    )
    if not output:
        output = "The virtual workspace has no files yet."
    ctx.context.record_tool_call("list_workspace_files", "", output)
    return output


@function_tool
def read_workspace_file(ctx: RunContextWrapper[AgentToolContext], path_or_document_id: str) -> str:
    """Read a file from the conversation-scoped virtual workspace.

    Args:
        path_or_document_id: Document ID, filename, or title from list_workspace_files.
    """

    row = _resolve_workspace_file(ctx.context, path_or_document_id)
    output = row.content_md
    ctx.context.record_tool_call("read_workspace_file", path_or_document_id, output)
    return output


@function_tool(timeout=20.0)
async def write_artifact(
    ctx: RunContextWrapper[AgentToolContext],
    title: str,
    filename: str,
    content_markdown: str,
) -> str:
    """Create an artifact file in the current conversation.

    Args:
        title: Human-readable artifact title.
        filename: Output filename, preferably ending in .md or .html.
        content_markdown: Complete artifact content. For HTML artifacts, pass raw complete HTML.
    """

    row = await _create_artifact(
        ctx.context,
        title=title,
        filename=filename,
        content_markdown=content_markdown,
    )
    ctx.context.created_documents.append(row)
    output = f"Created artifact {row.id}: {row.title} ({row.filename}, {row.mime_type})"
    ctx.context.record_tool_call("write_artifact", title, output)
    return output


@function_tool(timeout=30.0)
async def write_artifacts(
    ctx: RunContextWrapper[AgentToolContext],
    artifacts: list[ArtifactWriteInput],
) -> str:
    """Create multiple artifact files in the current conversation with one tool call.

    Use this instead of calling write_artifact repeatedly when the user asks for
    multiple files, such as a Markdown summary and an HTML demo.

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
    ctx.context.record_tool_call("write_artifacts", f"{len(artifacts)} artifacts", output)
    return output


@function_tool(timeout=15.0)
async def fetch_url_text(ctx: RunContextWrapper[AgentToolContext], url: str) -> str:
    """Fetch readable text from an http(s) URL. This is a limited browser-like tool without JavaScript.

    Args:
        url: Public http(s) URL to fetch.
    """

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RequestError("fetch_url_text only accepts http(s) URLs")
    await _assert_public_hostname(parsed.hostname)
    async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT_SECONDS, follow_redirects=True) as client:
        response = await client.get(url, headers={"User-Agent": "ProjectMonorepoAgent/0.1"})
        response.raise_for_status()
    text = _html_to_text(response.text)
    output = text[:_MAX_FETCH_CHARS]
    if len(text) > _MAX_FETCH_CHARS:
        output += "\n\n[truncated]"
    ctx.context.record_tool_call("fetch_url_text", url, output)
    return output


@function_tool(timeout=10.0)
async def execute_python(ctx: RunContextWrapper[AgentToolContext], code: str) -> str:
    """Execute a small Python snippet for calculation or text transformation.

    The runtime rejects filesystem, process, network, and dynamic-code imports.

    Args:
        code: Python code to execute. Print useful results to stdout.
    """

    if len(code) > _MAX_CODE_CHARS:
        raise RequestError("python code is too large")
    _validate_python_code(code)
    with tempfile.TemporaryDirectory(prefix="chat-agent-code-") as tmpdir:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-I",
            "-S",
            "-c",
            code,
            cwd=tmpdir,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=_CODE_TIMEOUT_SECONDS)
        except TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise RequestError("python execution timed out") from exc

    output = _decode_process_output(stdout, stderr, process.returncode)
    ctx.context.record_tool_call("execute_python", code, output)
    return output


def agent_runtime_tools() -> list[Any]:
    return [
        list_conversation_documents,
        read_document_markdown,
        search_conversation,
        list_workspace_files,
        read_workspace_file,
        fetch_url_text,
        execute_python,
        write_artifacts,
    ]


def _document_rows(context: AgentToolContext) -> list[ConversationDocumentRow]:
    return list(context.documents.values()) + context.created_documents


def _resolve_workspace_file(context: AgentToolContext, path_or_document_id: str) -> ConversationDocumentRow:
    value = path_or_document_id.strip()
    for row in _document_rows(context):
        if value in {row.id, row.filename, row.title}:
            return row
    raise RequestError("workspace file not found", details={"path_or_document_id": path_or_document_id})


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


async def _assert_public_hostname(hostname: str) -> None:
    infos = await asyncio.to_thread(socket.getaddrinfo, hostname, None)
    for info in infos:
        address = info[4][0]
        ip = ipaddress.ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
            raise RequestError("fetch_url_text cannot access private or local network addresses")


def _html_to_text(raw: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", raw)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _validate_python_code(code: str) -> None:
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise RequestError("invalid python code", details={"reason": str(exc)}) from exc
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                root_name = alias.name.split(".", 1)[0]
                if root_name not in _ALLOWED_CODE_IMPORTS:
                    raise RequestError("python import is not allowed", details={"module": root_name})
        if isinstance(node, ast.Name) and node.id in _BLOCKED_CODE_NAMES:
            raise RequestError("python name is not allowed", details={"name": node.id})
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise RequestError("python dunder attribute access is not allowed")


def _decode_process_output(stdout: bytes, stderr: bytes, returncode: int | None) -> str:
    output = stdout.decode("utf-8", errors="replace")
    error = stderr.decode("utf-8", errors="replace")
    combined = output
    if error:
        combined = f"{combined}\n[stderr]\n{error}".strip()
    if returncode not in {0, None}:
        combined = f"[exit_code={returncode}]\n{combined}".strip()
    combined = combined.strip() or "[no output]"
    if len(combined) > _MAX_CODE_OUTPUT_CHARS:
        return combined[:_MAX_CODE_OUTPUT_CHARS] + "\n\n[truncated]"
    return combined
