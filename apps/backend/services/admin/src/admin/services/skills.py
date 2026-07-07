"""Skill business service."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from kernel.errors import NotFoundError, RequestError
from sqlalchemy.ext.asyncio import AsyncSession

from admin.crud import skills as skill_crud
from admin.db import write_tx
from admin.deps import AuthContext
from admin.models.skill import SkillRow
from admin.schemas.skill import CreateSkillInput, InternalSkill, Skill, SkillSummary, UpdateSkillInput


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def to_schema(row: SkillRow) -> Skill:
    return Skill(
        id=row.id,
        user_id=row.user_id,
        org_id=row.org_id,
        username=row.username,
        name=row.name,
        description=row.description,
        body=row.body,
        status=row.status,  # type: ignore[arg-type]
        is_enabled=row.is_enabled,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


def to_summary(row: SkillRow) -> SkillSummary:
    return SkillSummary(
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


def to_internal_schema(row: SkillRow) -> InternalSkill:
    return InternalSkill(id=row.id, name=row.name, description=row.description, body=row.body)


class SkillService:
    def __init__(self, session: AsyncSession, current_user: AuthContext) -> None:
        self._session = session
        self._current_user = current_user

    async def list(self) -> list[SkillSummary]:
        rows = await skill_crud.list_skills(self._session, self._current_user.org_id)
        return [to_summary(row) for row in rows]

    async def get(self, skill_id: str) -> Skill:
        return to_schema(await self._get_row(skill_id))

    async def create(self, payload: CreateSkillInput) -> Skill:
        async with write_tx(self._session):
            await self._assert_name_free(payload.name)
            row = await skill_crud.create_skill(
                self._session,
                name=payload.name,
                description=payload.description,
                body=payload.body,
                status=payload.status,
                is_enabled=payload.is_enabled,
                user_id=self._current_user.user_id,
                org_id=self._current_user.org_id,
                username=self._current_user.username,
            )
        return to_schema(row)

    async def update(self, skill_id: str, payload: UpdateSkillInput) -> Skill:
        async with write_tx(self._session):
            row = await self._get_row(skill_id)
            values = payload.model_dump(exclude_unset=True)
            if "name" in values and values["name"] != row.name:
                await self._assert_name_free(values["name"])
            return to_schema(await skill_crud.update_skill(self._session, row, values))

    async def delete(self, skill_id: str) -> None:
        async with write_tx(self._session):
            await skill_crud.delete_skill(self._session, await self._get_row(skill_id))

    async def bulk_delete(self, ids: Sequence[str]) -> int:
        async with write_tx(self._session):
            return await skill_crud.bulk_delete_skills(self._session, list(ids), self._current_user.org_id)

    async def get_internal(self, skill_id: str) -> InternalSkill:
        row = await skill_crud.get_skill_internal(self._session, skill_id)
        if row is None:
            raise NotFoundError(f"skill {skill_id} not found")
        return to_internal_schema(row)

    async def _assert_name_free(self, name: str) -> None:
        existing = await skill_crud.get_skill_by_name(self._session, self._current_user.org_id, name)
        if existing is not None:
            raise RequestError(f"a skill named '{name}' already exists in this team")

    async def _get_row(self, skill_id: str) -> SkillRow:
        row = await skill_crud.get_skill(self._session, skill_id, self._current_user.org_id)
        if row is None:
            raise NotFoundError(f"skill {skill_id} not found")
        return row
