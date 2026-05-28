"""Intention business service."""

# This module defines an `async def list(self)` method on IntentionService,
# which shadows the builtin `list` inside the class body. Without delayed
# annotation evaluation, an annotation like `ids: list[str]` later in the
# same class body resolves `list` to that method (a function), not the
# builtin, and Python raises `TypeError: 'function' object is not subscriptable`
# at import time → uvicorn fails to load the app. PEP 563 fixes it cleanly.
from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from kernel.errors import NotFoundError
from sqlalchemy.ext.asyncio import AsyncSession

from admin.crud import intentions as intention_crud
from admin.deps import AuthContext
from admin.models.intention import IntentionRow
from admin.schemas.intention import CreateIntentionInput, Intention, UpdateIntentionInput


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def to_schema(row: IntentionRow) -> Intention:
    return Intention(
        id=row.id,
        user_id=row.user_id,
        username=row.username,
        name=row.name,
        description=row.description,
        scene_name=row.scene_name,
        examples=row.examples,
        status=row.status,  # type: ignore[arg-type]
        is_enabled=row.is_enabled,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


class IntentionService:
    def __init__(self, session: AsyncSession, current_user: AuthContext) -> None:
        self._session = session
        self._current_user = current_user

    async def list(self) -> list[Intention]:
        rows = await intention_crud.list_intentions(
            self._session,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        return [to_schema(row) for row in rows]

    async def get(self, intention_id: str) -> Intention:
        return to_schema(await self._get_row(intention_id))

    async def create(self, payload: CreateIntentionInput) -> Intention:
        row = await intention_crud.create_intention(
            self._session,
            description=payload.description,
            examples=payload.examples,
            is_enabled=payload.is_enabled,
            name=payload.name,
            scene_name=payload.scene_name,
            status=payload.status,
            user_id=self._current_user.user_id,
            username=self._current_user.username,
        )
        return to_schema(row)

    async def update(self, intention_id: str, payload: UpdateIntentionInput) -> Intention:
        row = await self._get_row(intention_id)
        values = payload.model_dump(exclude_unset=True)
        return to_schema(await intention_crud.update_intention(self._session, row, values))

    async def delete(self, intention_id: str) -> None:
        await intention_crud.delete_intention(
            self._session,
            await self._get_row(intention_id),
        )

    async def bulk_delete(self, ids: Sequence[str]) -> int:
        return await intention_crud.bulk_delete_intentions(
            self._session,
            list(ids),
            self._current_user.user_id,
            self._current_user.is_admin,
        )

    async def _get_row(self, intention_id: str) -> IntentionRow:
        row = await intention_crud.get_intention(
            self._session,
            intention_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"intention {intention_id} not found")
        return row
