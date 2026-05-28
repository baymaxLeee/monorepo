"""Model provider HTTP router (public — gateway-fronted)."""

from fastapi import APIRouter

from admin.deps import CurrentUser, DbSession
from admin.schemas.provider import (
    BulkDeleteModelProvidersInput,
    BulkDeleteModelProvidersResult,
    CreateModelProviderInput,
    ModelProvider,
    TestModelProviderInput,
    TestModelProviderResult,
    UpdateModelProviderInput,
)
from admin.services.providers import ModelProviderService

router = APIRouter(prefix="/providers", tags=["providers"])


@router.get("", response_model=list[ModelProvider])
async def list_providers(
    current_user: CurrentUser,
    session: DbSession,
) -> list[ModelProvider]:
    return await ModelProviderService(session, current_user).list()


@router.get("/{provider_id}", response_model=ModelProvider)
async def get_provider(
    provider_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> ModelProvider:
    return await ModelProviderService(session, current_user).get(provider_id)


@router.post("", response_model=ModelProvider, status_code=201)
async def create_provider(
    payload: CreateModelProviderInput,
    current_user: CurrentUser,
    session: DbSession,
) -> ModelProvider:
    return await ModelProviderService(session, current_user).create(payload)


@router.patch("/{provider_id}", response_model=ModelProvider)
async def update_provider(
    provider_id: str,
    payload: UpdateModelProviderInput,
    current_user: CurrentUser,
    session: DbSession,
) -> ModelProvider:
    return await ModelProviderService(session, current_user).update(provider_id, payload)


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> None:
    await ModelProviderService(session, current_user).delete(provider_id)


@router.post("/bulk-delete", response_model=BulkDeleteModelProvidersResult)
async def bulk_delete_providers(
    payload: BulkDeleteModelProvidersInput,
    current_user: CurrentUser,
    session: DbSession,
) -> BulkDeleteModelProvidersResult:
    deleted = await ModelProviderService(session, current_user).bulk_delete(payload.ids)
    return BulkDeleteModelProvidersResult(deleted=deleted)


@router.post("/{provider_id}/set-default", response_model=ModelProvider)
async def set_default_provider(
    provider_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> ModelProvider:
    return await ModelProviderService(session, current_user).set_default(provider_id)


@router.post("/{provider_id}/test", response_model=TestModelProviderResult)
async def test_provider(
    provider_id: str,
    payload: TestModelProviderInput,
    current_user: CurrentUser,
    session: DbSession,
) -> TestModelProviderResult:
    return await ModelProviderService(session, current_user).test(provider_id, payload)
