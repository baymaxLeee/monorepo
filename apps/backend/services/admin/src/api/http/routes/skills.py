"""Skill HTTP router."""

from typing import Annotated

from application.contracts.skill import (
    BulkDeleteSkillsInput,
    BulkDeleteSkillsResult,
    CreateSkillInput,
    CreateSkillNodeInput,
    MoveSkillNodeInput,
    PublishSkillInput,
    PublishSkillResult,
    RenameSkillNodeInput,
    Skill,
    SkillFileContent,
    SkillNodeMutationResult,
    SkillSummary,
    SkillValidationResult,
    SkillWorkspace,
    UpdateSkillFileContentInput,
    UpdateSkillInput,
)
from application.skills import SkillService
from fastapi import APIRouter, Query

from api.http.dependencies import AdminUser, CurrentUser, DbSession

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


@router.post("/{skill_id}/workspace/nodes", response_model=SkillNodeMutationResult)
async def create_skill_node(
    skill_id: str,
    payload: CreateSkillNodeInput,
    current_user: AdminUser,
    session: DbSession,
) -> SkillNodeMutationResult:
    return await SkillService(session, current_user).create_node(skill_id, payload)


@router.put("/{skill_id}/workspace/nodes/{node_id}/content", response_model=SkillNodeMutationResult)
async def update_skill_file_content(
    skill_id: str,
    node_id: str,
    payload: UpdateSkillFileContentInput,
    current_user: AdminUser,
    session: DbSession,
) -> SkillNodeMutationResult:
    return await SkillService(session, current_user).update_file_content(skill_id, node_id, payload)


@router.put("/{skill_id}/workspace/nodes/{node_id}/name", response_model=SkillNodeMutationResult)
async def rename_skill_node(
    skill_id: str,
    node_id: str,
    payload: RenameSkillNodeInput,
    current_user: AdminUser,
    session: DbSession,
) -> SkillNodeMutationResult:
    return await SkillService(session, current_user).rename_node(skill_id, node_id, payload)


@router.put("/{skill_id}/workspace/nodes/{node_id}/parent", response_model=SkillNodeMutationResult)
async def move_skill_node(
    skill_id: str,
    node_id: str,
    payload: MoveSkillNodeInput,
    current_user: AdminUser,
    session: DbSession,
) -> SkillNodeMutationResult:
    return await SkillService(session, current_user).move_node(skill_id, node_id, payload)


@router.delete("/{skill_id}/workspace/nodes/{node_id}", response_model=SkillNodeMutationResult)
async def delete_skill_node(
    skill_id: str,
    node_id: str,
    base_etag: Annotated[str, Query(min_length=64, max_length=64)],
    current_user: AdminUser,
    session: DbSession,
) -> SkillNodeMutationResult:
    return await SkillService(session, current_user).delete_node(skill_id, node_id, base_etag)


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
