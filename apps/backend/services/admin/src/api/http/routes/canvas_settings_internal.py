from typing import Annotated

from application.auth import AuthContext
from application.canvas_settings import CanvasSettingsService
from application.contracts.canvas_settings import CanvasSettings
from fastapi import APIRouter, Query

from api.http.dependencies import DbSession, InternalCaller

router = APIRouter(prefix="/internal/canvas/settings", tags=["internal-canvas-settings"])


@router.get("", response_model=CanvasSettings, operation_id="getInternalCanvasSettings")
async def get_settings(
    tenant_id: Annotated[str, Query(min_length=1)],
    workspace_id: Annotated[str, Query(min_length=1)],
    session: DbSession,
    _caller: InternalCaller,
) -> CanvasSettings:
    actor = AuthContext(user_id="", username="", email="", tenant_id=tenant_id, workspace_id=workspace_id)
    return await CanvasSettingsService(session, actor).get()
