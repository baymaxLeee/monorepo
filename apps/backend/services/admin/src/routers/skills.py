"""Skill HTTP router."""

from deps import AdminUser, CurrentUser, DbSession
from fastapi import APIRouter
from schemas.skill import (
    BulkDeleteSkillsInput,
    BulkDeleteSkillsResult,
    CreateSkillInput,
    Skill,
    SkillSummary,
    UpdateSkillInput,
)
from services.skills import SkillService

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("", response_model=list[SkillSummary])
async def list_skills(current_user: CurrentUser, session: DbSession) -> list[SkillSummary]:
    return await SkillService(session, current_user).list()


@router.get("/{skill_id}", response_model=Skill)
async def get_skill(skill_id: str, current_user: CurrentUser, session: DbSession) -> Skill:
    return await SkillService(session, current_user).get(skill_id)


@router.post("", response_model=Skill, status_code=201)
async def create_skill(
    payload: CreateSkillInput,
    current_user: AdminUser,
    session: DbSession,
) -> Skill:
    return await SkillService(session, current_user).create(payload)


@router.patch("/{skill_id}", response_model=Skill)
async def update_skill(
    skill_id: str,
    payload: UpdateSkillInput,
    current_user: AdminUser,
    session: DbSession,
) -> Skill:
    return await SkillService(session, current_user).update(skill_id, payload)


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(skill_id: str, current_user: AdminUser, session: DbSession) -> None:
    await SkillService(session, current_user).delete(skill_id)


@router.post("/bulk-delete", response_model=BulkDeleteSkillsResult)
async def bulk_delete_skills(
    payload: BulkDeleteSkillsInput,
    current_user: AdminUser,
    session: DbSession,
) -> BulkDeleteSkillsResult:
    deleted = await SkillService(session, current_user).bulk_delete(payload.ids)
    return BulkDeleteSkillsResult(deleted=deleted)
