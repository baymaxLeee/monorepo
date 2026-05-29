"""App registry business service.

The app registry is the operator-managed catalog of micro-frontends. Reads are
role-filtered (admin sees all; normal users see only enabled, non-admin-only
apps). Writes are admin-only — this catalog governs what every user can reach,
so a normal user must never mutate it.
"""

# `async def list(self)` shadows builtin `list`; defer annotation evaluation.
from __future__ import annotations

from datetime import UTC, datetime

from kernel.errors import ConflictError, ForbiddenError, NotFoundError
from sqlalchemy.ext.asyncio import AsyncSession

from admin.crud import apps as app_crud
from admin.deps import AuthContext
from admin.models.apps import AppRow
from admin.schemas.apps import App, CreateAppInput, UpdateAppInput


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def to_schema(row: AppRow) -> App:
    return App(
        id=row.id,
        title=row.title,
        base_path=row.base_path,
        remote_name=row.remote_name,
        expose_key=row.expose_key,
        entry=row.entry,
        requires_admin=row.requires_admin,
        is_enabled=row.is_enabled,
        sort_order=row.sort_order,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


class AppService:
    def __init__(self, session: AsyncSession, current_user: AuthContext) -> None:
        self._session = session
        self._current_user = current_user

    async def list(self) -> list[App]:
        rows = await app_crud.list_apps(self._session, self._current_user.is_admin)
        return [to_schema(row) for row in rows]

    async def get(self, app_id: str) -> App:
        return to_schema(await self._get_row(app_id))

    async def create(self, payload: CreateAppInput) -> App:
        self._require_admin()
        if await app_crud.get_app(self._session, payload.id) is not None:
            raise ConflictError(f"app {payload.id} already exists")
        row = await app_crud.create_app(
            self._session,
            app_id=payload.id,
            title=payload.title,
            base_path=payload.base_path,
            remote_name=payload.remote_name,
            expose_key=payload.expose_key,
            entry=payload.entry,
            requires_admin=payload.requires_admin,
            is_enabled=payload.is_enabled,
            sort_order=payload.sort_order,
        )
        return to_schema(row)

    async def update(self, app_id: str, payload: UpdateAppInput) -> App:
        self._require_admin()
        row = await self._get_row(app_id)
        values = payload.model_dump(exclude_unset=True)
        return to_schema(await app_crud.update_app(self._session, row, values))

    async def delete(self, app_id: str) -> None:
        self._require_admin()
        await app_crud.delete_app(self._session, await self._get_row(app_id))

    def _require_admin(self) -> None:
        if not self._current_user.is_admin:
            raise ForbiddenError("only admins may manage the app registry")

    async def _get_row(self, app_id: str) -> AppRow:
        row = await app_crud.get_app(self._session, app_id)
        if row is None:
            raise NotFoundError(f"app {app_id} not found")
        return row
