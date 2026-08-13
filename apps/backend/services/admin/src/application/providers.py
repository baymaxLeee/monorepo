"""Model provider business service."""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, cast

from infrastructure.persistence.database import write_tx
from infrastructure.persistence.models.provider import PROVIDER_KIND_CHAT, ModelProviderRow
from infrastructure.persistence.repositories import providers as provider_crud
from kernel.errors import ConflictError, NotFoundError, RequestError
from sqlalchemy.ext.asyncio import AsyncSession

from application.auth import AuthContext
from application.contracts.provider import (
    TOKENS_PER_K,
    CreateModelProviderInput,
    InternalModelProvider,
    LanguageApi,
    ModelProvider,
    ProviderKind,
    ProviderPricing,
    TestModelProviderInput,
    TestModelProviderResult,
    UpdateModelProviderInput,
)
from application.encryption import decrypt, encrypt, mask
from application.provider_tests import test_provider_by_kind
from application.provider_urls import validate_provider_base_url


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


def _parse_pricing(raw: str | None) -> ProviderPricing | None:
    if not raw:
        return None
    try:
        return ProviderPricing.model_validate_json(raw)
    except ValueError:
        return None


def _to_k_tokens(tokens: int) -> float:
    return tokens / TOKENS_PER_K


def _from_k_tokens(k_tokens: float) -> int:
    return round(k_tokens * TOKENS_PER_K)


def to_public_schema(row: ModelProviderRow) -> ModelProvider:
    return ModelProvider(
        id=row.id,
        user_id=row.user_id,
        org_id=row.org_id,
        name=row.name,
        model=row.model,
        provider_kind=cast(ProviderKind, row.provider_kind),
        api=cast(LanguageApi | None, row.api),
        base_url=row.base_url,
        api_key_masked=mask(decrypt(row.api_key_enc)),
        extra_body=_parse_extra_body(row.extra_body),
        pricing=_parse_pricing(row.pricing_json),
        context_window_k=_to_k_tokens(row.context_window),
        max_output_tokens_k=_to_k_tokens(row.max_output_tokens),
        supports_image_input=row.supports_image_input,
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
        provider_kind=cast(ProviderKind, row.provider_kind),
        api=cast(LanguageApi | None, row.api),
        base_url=row.base_url,
        api_key=decrypt(row.api_key_enc),
        extra_body=_parse_extra_body(row.extra_body),
        pricing=_parse_pricing(row.pricing_json),
        context_window=row.context_window,
        max_output_tokens=row.max_output_tokens,
        supports_image_input=row.supports_image_input,
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
            self._current_user.org_id,
        )
        return [to_public_schema(row) for row in rows]

    async def get(self, provider_id: str) -> ModelProvider:
        return to_public_schema(await self._get_row(provider_id))

    async def create(self, payload: CreateModelProviderInput) -> ModelProvider:
        if payload.is_default and payload.provider_kind != PROVIDER_KIND_CHAT:
            raise RequestError("only chat providers can be set as default")

        # DNS/SSRF validation performs network IO; keep it out of the DB transaction.
        base_url = await validate_provider_base_url(str(payload.base_url))
        async with write_tx(self._session):
            if payload.is_default:
                await provider_crud.clear_default_flag(
                    self._session,
                    self._current_user.org_id,
                )
            row = await provider_crud.create_provider(
                self._session,
                user_id=self._current_user.user_id,
                org_id=self._current_user.org_id,
                name=payload.name,
                model=payload.model,
                provider_kind=payload.provider_kind,
                api=payload.api,
                base_url=base_url,
                api_key_enc=encrypt(payload.api_key),
                extra_body=json.dumps(payload.extra_body),
                pricing_json=payload.pricing.model_dump_json() if payload.pricing else None,
                context_window=_from_k_tokens(payload.context_window_k),
                max_output_tokens=_from_k_tokens(payload.max_output_tokens_k),
                supports_image_input=payload.supports_image_input,
                is_default=payload.is_default,
                is_enabled=payload.is_enabled,
            )
        return to_public_schema(row)

    async def update(
        self,
        provider_id: str,
        payload: UpdateModelProviderInput,
    ) -> ModelProvider:
        # DNS/SSRF validation performs network IO; keep it out of the DB transaction.
        validated_base_url = (
            await validate_provider_base_url(str(payload.base_url)) if payload.base_url is not None else None
        )
        async with write_tx(self._session):
            row = await self._get_row(provider_id)

            values: dict[str, object] = {}
            if payload.name is not None:
                values["name"] = payload.name
            if payload.model is not None:
                values["model"] = payload.model
            if payload.provider_kind is not None:
                values["provider_kind"] = payload.provider_kind
            if "api" in payload.model_fields_set:
                values["api"] = payload.api
            if validated_base_url is not None:
                values["base_url"] = validated_base_url
            if payload.api_key is not None:
                values["api_key_enc"] = encrypt(payload.api_key)
            if payload.extra_body is not None:
                values["extra_body"] = json.dumps(payload.extra_body)
            if "pricing" in payload.model_fields_set:
                values["pricing_json"] = payload.pricing.model_dump_json() if payload.pricing else None
            if payload.context_window_k is not None:
                values["context_window"] = _from_k_tokens(payload.context_window_k)
            if payload.max_output_tokens_k is not None:
                values["max_output_tokens"] = _from_k_tokens(payload.max_output_tokens_k)
            if payload.supports_image_input is not None:
                values["supports_image_input"] = payload.supports_image_input
            if payload.is_enabled is not None:
                values["is_enabled"] = payload.is_enabled
            next_kind = payload.provider_kind if payload.provider_kind is not None else row.provider_kind
            next_api = payload.api if "api" in payload.model_fields_set else row.api
            if next_kind == PROVIDER_KIND_CHAT and next_api is None:
                raise RequestError("api is required for chat providers")
            if next_kind != PROVIDER_KIND_CHAT and next_api is not None:
                raise RequestError("api is only valid for chat providers")
            if next_kind != PROVIDER_KIND_CHAT:
                if payload.is_default:
                    raise RequestError("only chat providers can be set as default")
                values["is_default"] = False
            elif payload.is_default is not None:
                if payload.is_default and not row.is_default:
                    await provider_crud.clear_default_flag(
                        self._session,
                        self._current_user.org_id,
                    )
                values["is_default"] = payload.is_default

            if not values:
                return to_public_schema(row)
            context_window = (
                _from_k_tokens(payload.context_window_k) if payload.context_window_k is not None else row.context_window
            )
            max_output_tokens = (
                _from_k_tokens(payload.max_output_tokens_k)
                if payload.max_output_tokens_k is not None
                else row.max_output_tokens
            )
            if max_output_tokens >= context_window:
                raise RequestError("max_output_tokens_k must be less than context_window_k")
            return to_public_schema(await provider_crud.update_provider(self._session, row, values))

    async def delete(self, provider_id: str) -> None:
        async with write_tx(self._session):
            await provider_crud.delete_provider(self._session, await self._get_row(provider_id))

    async def bulk_delete(self, ids: Sequence[str]) -> int:
        async with write_tx(self._session):
            return await provider_crud.bulk_delete_providers(
                self._session,
                list(ids),
                self._current_user.org_id,
            )

    async def set_default(self, provider_id: str) -> ModelProvider:
        async with write_tx(self._session):
            row = await self._get_row(provider_id)
            if row.provider_kind != PROVIDER_KIND_CHAT:
                raise RequestError("only chat providers can be set as default")
            if not row.is_enabled:
                raise ConflictError("cannot mark a disabled provider as default")
            if row.is_default:
                return to_public_schema(row)
            await provider_crud.clear_default_flag(
                self._session,
                self._current_user.org_id,
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
        base_url = await validate_provider_base_url(
            str(payload.base_url) if payload.base_url is not None else row.base_url
        )
        model = payload.model or row.model
        api_key = payload.api_key if payload.api_key is not None else decrypt(row.api_key_enc)
        extra_body = _parse_extra_body(row.extra_body)
        return await test_provider_by_kind(
            provider_kind=row.provider_kind,
            api=row.api,
            base_url=base_url,
            api_key=api_key,
            model=model,
            extra_body=extra_body,
        )

    async def get_default_for_org(self, org_id: str) -> InternalModelProvider:
        row = await provider_crud.get_default_provider(self._session, org_id)
        if row is None:
            raise NotFoundError(f"no default model provider for org {org_id}")
        return to_internal_schema(row)

    async def get_by_kind_for_org(self, org_id: str, kind: str) -> InternalModelProvider:
        row = await provider_crud.get_first_enabled_by_kind(self._session, org_id, kind)
        if row is None:
            raise NotFoundError(f"no enabled {kind} provider for org {org_id}")
        return to_internal_schema(row)

    async def get_internal(self, provider_id: str, org_id: str) -> InternalModelProvider:
        row = await provider_crud.get_provider(self._session, provider_id, org_id)
        if row is None:
            raise NotFoundError(f"model provider {provider_id} not found")
        if not row.is_enabled:
            raise ConflictError(f"model provider {provider_id} is disabled")
        return to_internal_schema(row)

    async def _get_row(self, provider_id: str) -> ModelProviderRow:
        row = await provider_crud.get_provider(
            self._session,
            provider_id,
            self._current_user.org_id,
        )
        if row is None:
            raise NotFoundError(f"model provider {provider_id} not found")
        return row
