"""Intention HTTP router."""

from fastapi import APIRouter

from admin.deps import CurrentUser, DbSession
from admin.schemas.intention import (
    BulkDeleteIntentionsInput,
    BulkDeleteIntentionsResult,
    CreateIntentionInput,
    Intention,
    UpdateIntentionInput,
)
from admin.services.intentions import IntentionService

router = APIRouter(prefix="/intentions", tags=["intentions"])


@router.get("", response_model=list[Intention])
async def list_intentions(
    current_user: CurrentUser,
    session: DbSession,
) -> list[Intention]:
    return await IntentionService(session, current_user).list()


@router.get("/{intention_id}", response_model=Intention)
async def get_intention(
    intention_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> Intention:
    return await IntentionService(session, current_user).get(intention_id)


@router.post("", response_model=Intention, status_code=201)
async def create_intention(
    payload: CreateIntentionInput,
    current_user: CurrentUser,
    session: DbSession,
) -> Intention:
    return await IntentionService(session, current_user).create(payload)


@router.patch("/{intention_id}", response_model=Intention)
async def update_intention(
    intention_id: str,
    payload: UpdateIntentionInput,
    current_user: CurrentUser,
    session: DbSession,
) -> Intention:
    return await IntentionService(session, current_user).update(intention_id, payload)


@router.delete("/{intention_id}", status_code=204)
async def delete_intention(
    intention_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> None:
    await IntentionService(session, current_user).delete(intention_id)


@router.post("/bulk-delete", response_model=BulkDeleteIntentionsResult)
async def bulk_delete_intentions(
    payload: BulkDeleteIntentionsInput,
    current_user: CurrentUser,
    session: DbSession,
) -> BulkDeleteIntentionsResult:
    deleted = await IntentionService(session, current_user).bulk_delete(payload.ids)
    return BulkDeleteIntentionsResult(deleted=deleted)
