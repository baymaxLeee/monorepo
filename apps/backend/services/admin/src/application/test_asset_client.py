from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from bootstrap.config import Settings
from infrastructure.persistence.models.asset_claim_intent import AssetClaimIntentRow

from application.asset_client import AssetClient, AssetRevision


def _revision(content: bytes) -> AssetRevision:
    return AssetRevision(
        asset_id="019d0000-0000-7000-8000-000000000001",
        revision_id="019d0000-0000-7000-8000-000000000002",
        category="skill-archive",
        filename="skill.zip",
        media_type="application/zip",
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        created_by="user-1",
    )


async def _client_with_transport(handler: httpx.AsyncBaseTransport) -> AssetClient:
    client = AssetClient(Settings())
    await client._http.aclose()
    client._http = httpx.AsyncClient(
        base_url="http://asset.test",
        transport=handler,
        headers={"X-Internal-Token": "token", "X-Caller-Service": "admin"},
    )
    return client


@pytest.mark.asyncio
async def test_download_to_streams_and_verifies_revision_digest(tmp_path: Path) -> None:
    expected = b"valid archive bytes"
    revision = _revision(expected)

    async def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * len(expected))

    client = await _client_with_transport(httpx.MockTransport(respond))
    try:
        with pytest.raises(ValueError, match="checksum"):
            await client.download_to(
                revision=revision, tenant_id="tenant-1", workspace_id="workspace-1",
                target=tmp_path / "source.zip",
            )
    finally:
        await client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize(("desired_state", "expected_action"), [("active", "activate"), ("released", "release")])
async def test_deliver_claim_prepares_before_terminal_action(
    desired_state: str, expected_action: str
) -> None:
    requests: list[httpx.Request] = []

    async def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={})

    client = await _client_with_transport(httpx.MockTransport(respond))
    intent = AssetClaimIntentRow(
        tenant_id="tenant-1", workspace_id="workspace-1", owner_type="skill_node",
        owner_id="node-1", slot="content", asset_id="019d0000-0000-7000-8000-000000000001",
        revision_id="019d0000-0000-7000-8000-000000000002", kind="strong", generation=7,
        desired_state=desired_state, delivered_at=None, attempt_count=0, next_attempt_at=datetime.now(UTC),
        lease_until=None, state_version=1, last_error=None, created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    try:
        await client.deliver_claim(intent)
    finally:
        await client.aclose()

    assert [request.url.path for request in requests] == [
        "/internal/claims:prepare", f"/internal/claims:{expected_action}"
    ]
    prepare = requests[0].content.decode()
    terminal = requests[1].content.decode()
    assert '"generation":7' in prepare
    assert '"generation":7' in terminal
    assert '"asset_id"' in prepare
    assert '"asset_id"' not in terminal
