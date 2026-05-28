"""Model provider business service."""

from __future__ import annotations

import json
import time
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, cast

from kernel.errors import ConflictError, NotFoundError
from openai import APIError, AsyncOpenAI, AuthenticationError
from sqlalchemy.ext.asyncio import AsyncSession

from admin.crud import providers as provider_crud
from admin.deps import AuthContext
from admin.models.provider import ModelProviderRow
from admin.schemas.provider import (
    CreateModelProviderInput,
    InternalModelProvider,
    ModelProvider,
    TestModelProviderInput,
    TestModelProviderResult,
    UpdateModelProviderInput,
)
from admin.services.encryption import decrypt, encrypt, mask


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def _parse_extra_body(raw: str) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(decoded, dict):
        return {}
    return cast(dict[str, Any], decoded)


def to_public_schema(row: ModelProviderRow) -> ModelProvider:
    return ModelProvider(
        id=row.id,
        user_id=row.user_id,
        name=row.name,
        model=row.model,
        base_url=row.base_url,
        api_key_masked=mask(decrypt(row.api_key_enc)),
        extra_body=_parse_extra_body(row.extra_body),
        is_default=row.is_default,
        is_enabled=row.is_enabled,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


def to_internal_schema(row: ModelProviderRow) -> InternalModelProvider:
    return InternalModelProvider(
        id=row.id,
        user_id=row.user_id,
        name=row.name,
        model=row.model,
        base_url=row.base_url,
        api_key=decrypt(row.api_key_enc),
        extra_body=_parse_extra_body(row.extra_body),
        is_default=row.is_default,
        is_enabled=row.is_enabled,
    )


class ModelProviderService:
    def __init__(self, session: AsyncSession, current_user: AuthContext) -> None:
        self._session = session
        self._current_user = current_user

    async def list(self) -> list[ModelProvider]:
        rows = await provider_crud.list_providers(
            self._session,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        return [to_public_schema(row) for row in rows]

    async def get(self, provider_id: str) -> ModelProvider:
        return to_public_schema(await self._get_row(provider_id))

    async def create(self, payload: CreateModelProviderInput) -> ModelProvider:
        # Only one default per user; toggling a new one as default demotes
        # the existing default in the same transaction.
        if payload.is_default:
            await provider_crud.clear_default_flag(
                self._session,
                self._current_user.user_id,
            )

        row = await provider_crud.create_provider(
            self._session,
            user_id=self._current_user.user_id,
            name=payload.name,
            model=payload.model,
            base_url=str(payload.base_url).rstrip("/"),
            api_key_enc=encrypt(payload.api_key),
            extra_body=json.dumps(payload.extra_body),
            is_default=payload.is_default,
            is_enabled=payload.is_enabled,
        )
        return to_public_schema(row)

    async def update(
        self,
        provider_id: str,
        payload: UpdateModelProviderInput,
    ) -> ModelProvider:
        row = await self._get_row(provider_id)

        values: dict[str, object] = {}
        if payload.name is not None:
            values["name"] = payload.name
        if payload.model is not None:
            values["model"] = payload.model
        if payload.base_url is not None:
            values["base_url"] = str(payload.base_url).rstrip("/")
        if payload.api_key is not None:
            values["api_key_enc"] = encrypt(payload.api_key)
        if payload.extra_body is not None:
            values["extra_body"] = json.dumps(payload.extra_body)
        if payload.is_enabled is not None:
            values["is_enabled"] = payload.is_enabled
        if payload.is_default is not None:
            if payload.is_default and not row.is_default:
                await provider_crud.clear_default_flag(
                    self._session,
                    self._current_user.user_id,
                )
            values["is_default"] = payload.is_default

        if not values:
            return to_public_schema(row)
        return to_public_schema(await provider_crud.update_provider(self._session, row, values))

    async def delete(self, provider_id: str) -> None:
        await provider_crud.delete_provider(self._session, await self._get_row(provider_id))

    async def bulk_delete(self, ids: Sequence[str]) -> int:
        return await provider_crud.bulk_delete_providers(
            self._session,
            list(ids),
            self._current_user.user_id,
            self._current_user.is_admin,
        )

    async def set_default(self, provider_id: str) -> ModelProvider:
        row = await self._get_row(provider_id)
        if not row.is_enabled:
            raise ConflictError("cannot mark a disabled provider as default")
        if row.is_default:
            return to_public_schema(row)
        await provider_crud.clear_default_flag(
            self._session,
            self._current_user.user_id,
        )
        return to_public_schema(
            await provider_crud.update_provider(
                self._session,
                row,
                {"is_default": True},
            )
        )

    async def test(
        self,
        provider_id: str,
        payload: TestModelProviderInput,
    ) -> TestModelProviderResult:
        row = await self._get_row(provider_id)
        base_url = str(payload.base_url).rstrip("/") if payload.base_url is not None else row.base_url
        model = payload.model or row.model
        api_key = payload.api_key if payload.api_key is not None else decrypt(row.api_key_enc)

        client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=15.0)
        start = time.perf_counter()
        try:
            resp = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": "ping"},
                ],
                max_tokens=4,
                stream=False,
            )
        except AuthenticationError as exc:
            return TestModelProviderResult(ok=False, error=f"authentication: {exc}")
        except APIError as exc:
            return TestModelProviderResult(ok=False, error=f"api: {exc}")
        except Exception as exc:
            return TestModelProviderResult(ok=False, error=f"unexpected: {exc}")
        finally:
            await client.close()

        latency_ms = int((time.perf_counter() - start) * 1000)
        sample = ""
        if resp.choices:
            sample = (resp.choices[0].message.content or "").strip()
        return TestModelProviderResult(
            ok=True,
            latency_ms=latency_ms,
            sample=sample[:200] if sample else None,
        )

    # --- internal API surface (consumer services only) ---

    async def get_default_for_user(self, user_id: str) -> InternalModelProvider:
        row = await provider_crud.get_default_provider(self._session, user_id)
        if row is None:
            raise NotFoundError(f"no default model provider for user {user_id}")
        return to_internal_schema(row)

    async def get_internal(self, provider_id: str, user_id: str) -> InternalModelProvider:
        row = await provider_crud.get_provider_for_internal(self._session, provider_id)
        if row is None:
            raise NotFoundError(f"model provider {provider_id} not found")
        # Even on the internal surface we still enforce per-user ownership —
        # callers (chat, ...) only ever ask for providers belonging to the
        # currently authenticated end-user.
        if row.user_id != user_id:
            raise NotFoundError(f"model provider {provider_id} not found")
        if not row.is_enabled:
            raise ConflictError(f"model provider {provider_id} is disabled")
        return to_internal_schema(row)

    async def _get_row(self, provider_id: str) -> ModelProviderRow:
        row = await provider_crud.get_provider(
            self._session,
            provider_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"model provider {provider_id} not found")
        return row
