"""Scene business service."""

from datetime import UTC

from kernel.errors import NotFoundError
from sqlalchemy.ext.asyncio import AsyncSession

from admin.crud import scenes as scene_crud
from admin.deps import AuthContext
from admin.models.scene import SceneRow
from admin.schemas.scene import CreateSceneInput, Scene, UpdateSceneInput


def _iso(dt) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def to_schema(row: SceneRow) -> Scene:
    return Scene(
        id=row.id,
        user_id=row.user_id,
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
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        return [to_schema(row) for row in rows]

    async def get(self, scene_id: str) -> Scene:
        return to_schema(await self._get_row(scene_id))

    async def create(self, payload: CreateSceneInput) -> Scene:
        row = await scene_crud.create_scene(
            self._session,
            description=payload.description,
            is_enabled=payload.is_enabled,
            name=payload.name,
            status=payload.status,
            user_id=self._current_user.user_id,
            username=self._current_user.username,
        )
        return to_schema(row)

    async def update(self, scene_id: str, payload: UpdateSceneInput) -> Scene:
        row = await self._get_row(scene_id)
        values = payload.model_dump(exclude_unset=True)
        return to_schema(await scene_crud.update_scene(self._session, row, values))

    async def delete(self, scene_id: str) -> None:
        await scene_crud.delete_scene(self._session, await self._get_row(scene_id))

    async def bulk_delete(self, ids: list[str]) -> int:
        return await scene_crud.bulk_delete_scenes(
            self._session,
            ids,
            self._current_user.user_id,
            self._current_user.is_admin,
        )

    async def _get_row(self, scene_id: str) -> SceneRow:
        row = await scene_crud.get_scene(
            self._session,
            scene_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"scene {scene_id} not found")
        return row
