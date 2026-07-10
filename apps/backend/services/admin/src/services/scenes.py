"""Scene business service."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from crud import scenes as scene_crud
from db import write_tx
from deps import AuthContext
from kernel.errors import NotFoundError
from models.scene import SceneRow
from schemas.scene import CreateSceneInput, Scene, UpdateSceneInput
from sqlalchemy.ext.asyncio import AsyncSession


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def to_schema(row: SceneRow) -> Scene:
    return Scene(
        id=row.id,
        user_id=row.user_id,
        org_id=row.org_id,
        username=row.username,
        name=row.name,
        description=row.description,
        status=row.status,  # type: ignore[arg-type]
        is_enabled=row.is_enabled,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


class SceneService:
    def __init__(self, session: AsyncSession, current_user: AuthContext) -> None:
        self._session = session
        self._current_user = current_user

    async def list(self) -> list[Scene]:
        rows = await scene_crud.list_scenes(
            self._session,
            self._current_user.org_id,
        )
        return [to_schema(row) for row in rows]

    async def get(self, scene_id: str) -> Scene:
        return to_schema(await self._get_row(scene_id))

    async def create(self, payload: CreateSceneInput) -> Scene:
        async with write_tx(self._session):
            row = await scene_crud.create_scene(
                self._session,
                description=payload.description,
                is_enabled=payload.is_enabled,
                name=payload.name,
                status=payload.status,
                user_id=self._current_user.user_id,
                org_id=self._current_user.org_id,
                username=self._current_user.username,
            )
        return to_schema(row)

    async def update(self, scene_id: str, payload: UpdateSceneInput) -> Scene:
        async with write_tx(self._session):
            row = await self._get_row(scene_id)
            values = payload.model_dump(exclude_unset=True)
            return to_schema(await scene_crud.update_scene(self._session, row, values))

    async def delete(self, scene_id: str) -> None:
        async with write_tx(self._session):
            await scene_crud.delete_scene(self._session, await self._get_row(scene_id))

    async def bulk_delete(self, ids: Sequence[str]) -> int:
        async with write_tx(self._session):
            return await scene_crud.bulk_delete_scenes(
                self._session,
                list(ids),
                self._current_user.org_id,
            )

    async def _get_row(self, scene_id: str) -> SceneRow:
        row = await scene_crud.get_scene(
            self._session,
            scene_id,
            self._current_user.org_id,
        )
        if row is None:
            raise NotFoundError(f"scene {scene_id} not found")
        return row
