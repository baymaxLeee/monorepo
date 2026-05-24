"""Scene HTTP router."""

from fastapi import APIRouter

from admin.deps import CurrentUser, DbSession
from admin.schemas.scene import (
    BulkDeleteScenesInput,
    BulkDeleteScenesResult,
    CreateSceneInput,
    Scene,
    UpdateSceneInput,
)
from admin.services.scenes import SceneService

router = APIRouter(prefix="/scenes", tags=["scenes"])


@router.get("", response_model=list[Scene])
async def list_scenes(
    current_user: CurrentUser,
    session: DbSession,
) -> list[Scene]:
    return await SceneService(session, current_user).list()


@router.get("/{scene_id}", response_model=Scene)
async def get_scene(
    scene_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> Scene:
    return await SceneService(session, current_user).get(scene_id)


@router.post("", response_model=Scene, status_code=201)
async def create_scene(
    payload: CreateSceneInput,
    current_user: CurrentUser,
    session: DbSession,
) -> Scene:
    return await SceneService(session, current_user).create(payload)


@router.patch("/{scene_id}", response_model=Scene)
async def update_scene(
    scene_id: str,
    payload: UpdateSceneInput,
    current_user: CurrentUser,
    session: DbSession,
) -> Scene:
    return await SceneService(session, current_user).update(scene_id, payload)


@router.delete("/{scene_id}", status_code=204)
async def delete_scene(
    scene_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> None:
    await SceneService(session, current_user).delete(scene_id)


@router.post("/bulk-delete", response_model=BulkDeleteScenesResult)
async def bulk_delete_scenes(
    payload: BulkDeleteScenesInput,
    current_user: CurrentUser,
    session: DbSession,
) -> BulkDeleteScenesResult:
    deleted = await SceneService(session, current_user).bulk_delete(payload.ids)
    return BulkDeleteScenesResult(deleted=deleted)
