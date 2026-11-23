from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from infrastructure.persistence.models.asset_claim_intent import AssetClaimIntentRow

from application.storage_client import StorageClient


@pytest.mark.asyncio
async def test_released_claim_does_not_require_revision_or_prepare() -> None:
    client = object.__new__(StorageClient)
    client._prepare_claim = AsyncMock()  # type: ignore[method-assign]
    client._mutate_claim = AsyncMock()  # type: ignore[method-assign]
    intent = cast(
        AssetClaimIntentRow,
        SimpleNamespace(
            owner_type="document",
            owner_id="document-1",
            slot="source",
            generation=1,
            asset_id="",
            revision_id=None,
            kind="strong",
            desired_state="released",
        ),
    )

    await client.deliver_claim(intent)

    client._prepare_claim.assert_not_awaited()
    client._mutate_claim.assert_awaited_once_with(
        True,
        owner_type="document",
        owner_id="document-1",
        slot="source",
        generation=1,
    )


@pytest.mark.asyncio
async def test_active_claim_requires_exact_revision_before_prepare() -> None:
    client = object.__new__(StorageClient)
    client._prepare_claim = AsyncMock()  # type: ignore[method-assign]
    client._mutate_claim = AsyncMock()  # type: ignore[method-assign]
    intent = cast(
        AssetClaimIntentRow,
        SimpleNamespace(
            owner_type="document",
            owner_id="document-1",
            slot="source",
            generation=1,
            asset_id="asset-1",
            revision_id=None,
            kind="strong",
            desired_state="active",
        ),
    )

    with pytest.raises(ValueError, match="revision_id"):
        await client.deliver_claim(intent)

    client._prepare_claim.assert_not_awaited()
    client._mutate_claim.assert_not_awaited()
