from application.canvas_settings import CanvasSettingsService
from application.contracts.canvas_settings import CanvasSettings, UpdateCanvasSettings
from fastapi import APIRouter

from api.http.dependencies import AdminUser, CurrentUser, DbSession

router = APIRouter(prefix="/canvas/settings", tags=["canvas-settings"])


@router.get("", response_model=CanvasSettings, operation_id="getCanvasSettings")
async def get_settings(session: DbSession, user: CurrentUser) -> CanvasSettings:
    return await CanvasSettingsService(session, user).get()


@router.put("", response_model=CanvasSettings, operation_id="updateCanvasSettings")
async def update_settings(payload: UpdateCanvasSettings, session: DbSession, user: AdminUser) -> CanvasSettings:
    return await CanvasSettingsService(session, user).update(payload)
