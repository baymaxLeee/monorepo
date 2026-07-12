"""Skill HTTP router."""

from deps import AdminUser, CurrentUser, DbSession
from fastapi import APIRouter
from schemas.skill import (
    BulkDeleteSkillsInput,
    BulkDeleteSkillsResult,
    CreateSkillInput,
    PublishSkillInput,
    PublishSkillResult,
    Skill,
    SkillFileContent,
    SkillSummary,
    SkillValidationResult,
    SkillWorkspace,
    UpdateSkillInput,
    UpdateSkillWorkspaceInput,
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


@router.get("/{skill_id}/workspace", response_model=SkillWorkspace)
async def get_skill_workspace(skill_id: str, current_user: CurrentUser, session: DbSession) -> SkillWorkspace:
    return await SkillService(session, current_user).get_workspace(skill_id)


@router.get("/{skill_id}/workspace/files/{node_id}", response_model=SkillFileContent)
async def get_skill_file(
    skill_id: str, node_id: str, current_user: CurrentUser, session: DbSession
) -> SkillFileContent:
    return await SkillService(session, current_user).get_file(skill_id, node_id)


@router.patch("/{skill_id}/workspace", response_model=SkillWorkspace)
async def update_skill_workspace(
    skill_id: str,
    payload: UpdateSkillWorkspaceInput,
    current_user: AdminUser,
    session: DbSession,
) -> SkillWorkspace:
    return await SkillService(session, current_user).update_workspace(skill_id, payload)


@router.post("/{skill_id}/validate", response_model=SkillValidationResult)
async def validate_skill(skill_id: str, current_user: AdminUser, session: DbSession) -> SkillValidationResult:
    return await SkillService(session, current_user).validate(skill_id)


@router.post("/{skill_id}/publish", response_model=PublishSkillResult)
async def publish_skill(
    skill_id: str,
    payload: PublishSkillInput,
    current_user: AdminUser,
    session: DbSession,
) -> PublishSkillResult:
    return await SkillService(session, current_user).publish(skill_id, payload)


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
