"""Bot business service."""

from __future__ import annotations

from datetime import UTC, datetime

from kernel.errors import NotFoundError, RequestError
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from admin.crud import bots as bot_crud
from admin.crud import providers as provider_crud
from admin.deps import ADMIN_USER_ID, AuthContext
from admin.models.bot import BotRow
from admin.models.provider import (
    PROVIDER_KIND_CHAT,
    PROVIDER_KIND_IMAGE,
    PROVIDER_KIND_VIDEO,
)
from admin.schemas.bot import Bot, ResolvedAgent, UpdateBotInput
from admin.schemas.provider import InternalModelProvider
from admin.services.providers import to_internal_schema as provider_to_internal_schema


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def to_schema(row: BotRow) -> Bot:
    return Bot(
        id=row.id,
        user_id=row.user_id,
        username="admin" if row.user_id == ADMIN_USER_ID else row.user_id,
        name=row.name,
        status=row.status,  # type: ignore[arg-type]
        text_provider_id=row.text_provider_id,
        image_provider_id=row.image_provider_id,
        video_provider_id=row.video_provider_id,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


class BotService:
    def __init__(
        self,
        session: AsyncSession,
        current_user: AuthContext,
        redis: Redis | None = None,
    ) -> None:
        self._session = session
        self._current_user = current_user
        self._redis = redis

    async def list(self) -> list[Bot]:
        rows = await bot_crud.list_bots(
            self._session,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        return [to_schema(row) for row in rows]

    async def get(self, bot_id: str) -> Bot:
        row = await bot_crud.get_bot(
            self._session,
            bot_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"bot {bot_id} not found")
        return to_schema(row)

    async def create(self, name: str) -> Bot:
        row = await bot_crud.create_bot(self._session, name, self._current_user.user_id)
        if self._redis is not None:
            await self._redis.incr("admin:bots:created")
        return to_schema(row)

    async def update(self, bot_id: str, payload: UpdateBotInput) -> Bot:
        row = await bot_crud.get_bot(
            self._session,
            bot_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"bot {bot_id} not found")

        fields_set = payload.model_fields_set
        values: dict[str, object] = {}
        if "name" in fields_set and payload.name is not None:
            values["name"] = payload.name
        if "status" in fields_set and payload.status is not None:
            values["status"] = payload.status
        for field, expected_kind in (
            ("text_provider_id", PROVIDER_KIND_CHAT),
            ("image_provider_id", PROVIDER_KIND_IMAGE),
            ("video_provider_id", PROVIDER_KIND_VIDEO),
        ):
            if field not in fields_set:
                continue
            provider_id = getattr(payload, field)
            if provider_id:
                await self._assert_provider_kind(provider_id, expected_kind)
            values[field] = provider_id

        if not values:
            return to_schema(row)
        return to_schema(await bot_crud.update_bot(self._session, row, values))

    async def get_resolved(self, bot_id: str) -> ResolvedAgent:
        row = await bot_crud.get_bot(
            self._session,
            bot_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"bot {bot_id} not found")
        return ResolvedAgent(
            id=row.id,
            name=row.name,
            text_provider=await self._resolve_provider(row.text_provider_id),
            image_provider=await self._resolve_provider(row.image_provider_id),
            video_provider=await self._resolve_provider(row.video_provider_id),
        )

    async def _resolve_provider(self, provider_id: str | None) -> InternalModelProvider | None:
        if not provider_id:
            return None
        provider = await provider_crud.get_provider(
            self._session,
            provider_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if provider is None or not provider.is_enabled:
            return None
        return provider_to_internal_schema(provider)

    async def delete(self, bot_id: str) -> None:
        row = await bot_crud.get_bot(
            self._session,
            bot_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"bot {bot_id} not found")
        await bot_crud.delete_bot(self._session, row)

    async def _assert_provider_kind(self, provider_id: str, expected_kind: str) -> None:
        provider = await provider_crud.get_provider(
            self._session,
            provider_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if provider is None:
            raise RequestError(f"model provider {provider_id} not found")
        if provider.provider_kind != expected_kind:
            raise RequestError(f"model provider {provider_id} is not a {expected_kind} model")
