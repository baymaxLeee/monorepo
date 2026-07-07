"""App registry business service.

The app registry is a GLOBAL platform catalog of micro-frontends. Reads are
role-filtered; writes are super_admin-only — this catalog governs what every
user can reach, so no org-level role may mutate it. Visibility tiers:

- super_admin: every app, including disabled ones (management view).
- org_admin: enabled apps incl. admin-only ones (so they can mount the admin
  MFE for member approval / org config).
- member/normal: only enabled, non-admin-only apps.

`get` applies the SAME visibility as `list` so a normal user cannot probe an
admin-only or disabled app by id.
"""

from __future__ import annotations

from datetime import UTC, datetime

from kernel.errors import ConflictError, ForbiddenError, NotFoundError
from sqlalchemy.ext.asyncio import AsyncSession

from admin.crud import apps as app_crud
from admin.db import write_tx
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
        rows = await app_crud.list_apps(
            self._session,
            include_disabled=self._current_user.is_super_admin,
            include_admin_only=self._can_see_admin_apps(),
        )
        return [to_schema(row) for row in rows]

    async def get(self, app_id: str) -> App:
        row = await self._get_row(app_id)
        if not self._can_see(row):
            # Hide existence: a non-visible app is indistinguishable from a
            # missing one for callers without the privilege to see it.
            raise NotFoundError(f"app {app_id} not found")
        return to_schema(row)

    async def create(self, payload: CreateAppInput) -> App:
        self._require_super_admin()
        async with write_tx(self._session):
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
        self._require_super_admin()
        async with write_tx(self._session):
            row = await self._get_row(app_id)
            values = payload.model_dump(exclude_unset=True)
            return to_schema(await app_crud.update_app(self._session, row, values))

    async def delete(self, app_id: str) -> None:
        self._require_super_admin()
        async with write_tx(self._session):
            await app_crud.delete_app(self._session, await self._get_row(app_id))

    def _can_see_admin_apps(self) -> bool:
        return self._current_user.is_super_admin or self._current_user.is_org_admin

    def _can_see(self, row: AppRow) -> bool:
        if self._current_user.is_super_admin:
            return True
        if not row.is_enabled:
            return False
        return not (row.requires_admin and not self._current_user.is_org_admin)

    def _require_super_admin(self) -> None:
        if not self._current_user.is_super_admin:
            raise ForbiddenError("only super_admin may manage the app registry")

    async def _get_row(self, app_id: str) -> AppRow:
        row = await app_crud.get_app(self._session, app_id)
        if row is None:
            raise NotFoundError(f"app {app_id} not found")
        return row
