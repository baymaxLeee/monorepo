"""App registry HTTP router.

GET is role-filtered in the service (admin -> all; normal -> enabled public
apps). Mutations are admin-only (enforced in the service). The platform shell
calls `GET /apps` to discover which apps the current user may mount.
"""

from fastapi import APIRouter

from admin.deps import CurrentUser, DbSession
from admin.schemas.apps import App, CreateAppInput, UpdateAppInput
from admin.services.apps import AppService

router = APIRouter(prefix="/apps", tags=["apps"])


@router.get("", response_model=list[App])
async def list_apps(
    current_user: CurrentUser,
    session: DbSession,
) -> list[App]:
    return await AppService(session, current_user).list()


@router.get("/{app_id}", response_model=App)
async def get_app(
    app_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> App:
    return await AppService(session, current_user).get(app_id)


@router.post("", response_model=App, status_code=201)
async def create_app(
    payload: CreateAppInput,
    current_user: CurrentUser,
    session: DbSession,
) -> App:
    return await AppService(session, current_user).create(payload)


@router.patch("/{app_id}", response_model=App)
async def update_app(
    app_id: str,
    payload: UpdateAppInput,
    current_user: CurrentUser,
    session: DbSession,
) -> App:
    return await AppService(session, current_user).update(app_id, payload)


@router.delete("/{app_id}", status_code=204)
async def delete_app(
    app_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> None:
    await AppService(session, current_user).delete(app_id)
