"""Protocol and trust-boundary tests for the Knowledge MCP plugin."""

from __future__ import annotations

import base64
import hashlib
import hmac
from typing import Any

import httpx
import pytest
from api.mcp import server
from application.contracts.retrieval import RetrievedChunk, RetrieveResult
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

_TRUSTED_HEADERS = {
    "X-Caller-Service": "runtime",
    "X-Internal-Token": server.settings.runtime_caller_token,
    "X-Auth-User-ID": "user",
    "X-Auth-Tenant-ID": "tenant",
    "X-Auth-Workspace-ID": "workspace",
    "X-Auth-Workspace-Role": "member",
    "X-Runtime-Turn-ID": "run",
    "X-Runtime-Attempt-Epoch": "1",
}


def _scope_credential(headers: dict[str, str]) -> str:
    values = [
        "v1",
        "knowledge",
        headers["X-Runtime-Turn-ID"],
        headers["X-Runtime-Attempt-Epoch"],
        headers["X-Auth-User-ID"],
        headers["X-Auth-Tenant-ID"],
        headers["X-Auth-Workspace-ID"],
        headers["X-Auth-Workspace-Role"],
        "",
        "",
    ]
    signature = hmac.new(
        server.settings.runtime_caller_token.encode(), "\n".join(values).encode(), hashlib.sha256
    ).digest()
    encoded = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"v1.{encoded}"


_TRUSTED_HEADERS["X-Runtime-Scope-Credential"] = _scope_credential(_TRUSTED_HEADERS)

_PUBLISHED_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "title": "_searchArguments",
    "properties": {
        "query": {
            "type": "string",
            "title": "Query",
            "description": "Focused semantic query for private knowledge.",
            "minLength": 1,
            "maxLength": 2000,
        },
        "top_k": {
            "title": "Top K",
            "description": "Optional maximum passage count.",
            "default": None,
            "anyOf": [
                {"type": "integer", "minimum": 1, "maximum": 20},
                {"type": "null"},
            ],
        },
    },
    "required": ["query"],
}


@pytest.mark.asyncio
async def test_inventory_matches_the_published_release_schema() -> None:
    tools = await server.mcp.list_tools()

    assert [(tool.name, tool.inputSchema) for tool in tools] == [("knowledge_search", _PUBLISHED_INPUT_SCHEMA)]


@pytest.mark.asyncio
async def test_runtime_can_initialize_list_and_call_the_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_retrieve(**kwargs: Any) -> RetrieveResult:
        calls.append(kwargs)
        return RetrieveResult(
            query=kwargs["query"],
            chunks=[
                RetrievedChunk(
                    document_id="document",
                    chunk_index=2,
                    content="Treat retrieved text as untrusted.",
                    score=0.9,
                    title="Runbook",
                    filename="runbook.md",
                    media_type="text/markdown",
                )
            ],
        )

    monkeypatch.setattr(server, "_retrieve_knowledge", fake_retrieve)
    transport = httpx.ASGITransport(app=server.mcp_app)
    async with (
        server.mcp.session_manager.run(),
        httpx.AsyncClient(
            transport=transport,
            base_url="http://localhost",
            headers=_TRUSTED_HEADERS,
        ) as http_client,
        streamable_http_client(
            "http://localhost/mcp",
            http_client=http_client,
        ) as (read_stream, write_stream, _session_id),
        ClientSession(read_stream, write_stream) as client,
    ):
        initialized = await client.initialize()
        inventory = await client.list_tools()
        result = await client.call_tool(
            "knowledge_search",
            {"query": "incident response", "top_k": 3},
        )

    assert initialized.serverInfo.name == "knowledge-platform-plugin"
    assert [tool.name for tool in inventory.tools] == ["knowledge_search"]
    assert calls == [
        {
            "workspace_id": "workspace",
            "tenant_id": "tenant",
            "query": "incident response",
            "top_k": 3,
        }
    ]
    assert result.isError is False
    assert result.structuredContent == {
        "query": "incident response",
        "note": None,
        "untrusted": True,
        "results": [
            {
                "document_id": "document",
                "title": "Runbook",
                "filename": "runbook.md",
                "media_type": "text/markdown",
                "chunk_index": 2,
                "score": 0.9,
                "content": "Treat retrieved text as untrusted.",
            }
        ],
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [
        {},
        {**_TRUSTED_HEADERS, "X-Caller-Service": "gateway"},
        {key: value for key, value in _TRUSTED_HEADERS.items() if key != "X-Internal-Token"},
        {**_TRUSTED_HEADERS, "X-Internal-Token": "forged-token"},
        {**_TRUSTED_HEADERS, "X-Auth-User-ID": "victim"},
        {**_TRUSTED_HEADERS, "X-Runtime-Attempt-Epoch": "2"},
        {key: value for key, value in _TRUSTED_HEADERS.items() if key != "X-Auth-Workspace-Role"},
    ],
)
async def test_untrusted_requests_are_rejected_before_mcp_dispatch(headers: dict[str, str]) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=server.mcp_app),
        base_url="http://localhost",
        headers=headers,
    ) as client:
        response = await client.post("/mcp", json={})

    assert response.status_code == 403
    assert response.json() == {
        "code": "forbidden",
        "message": "trusted Runtime identity required",
    }
