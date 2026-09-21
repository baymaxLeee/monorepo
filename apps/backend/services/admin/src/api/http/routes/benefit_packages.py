from typing import Annotated

from application.benefit_packages import BenefitPackageService
from application.contracts.benefit_package import (
    AssetGroupCleanup,
    BenefitPackage,
    CreateBenefitPackageInput,
    UpdateBenefitPackageInput,
)
from fastapi import APIRouter, Query, Response, status

from api.http.dependencies import AdminUser, CurrentUser, DbSession

router = APIRouter(prefix="/benefit-packages", tags=["canvas-benefit-packages"])


@router.get(
    "/asset-group-cleanups",
    response_model=list[AssetGroupCleanup],
    operation_id="listBenefitPackageAssetGroupCleanups",
)
async def list_asset_group_cleanups(session: DbSession, user: AdminUser) -> list[AssetGroupCleanup]:
    return await BenefitPackageService(session, user).list_asset_group_cleanups()


@router.post(
    "/asset-group-cleanups/{cleanup_id}/retry",
    response_model=AssetGroupCleanup,
    operation_id="retryBenefitPackageAssetGroupCleanup",
)
async def retry_asset_group_cleanup(cleanup_id: str, session: DbSession, user: AdminUser) -> AssetGroupCleanup:
    return await BenefitPackageService(session, user).retry_asset_group_cleanup(cleanup_id)


@router.get("", response_model=list[BenefitPackage], operation_id="listBenefitPackages")
async def list_packages(
    session: DbSession, user: CurrentUser, available_only: Annotated[bool, Query()] = False
) -> list[BenefitPackage]:
    return await BenefitPackageService(session, user).list(available_only)


@router.post("", response_model=BenefitPackage, operation_id="createBenefitPackage")
async def create_package(payload: CreateBenefitPackageInput, session: DbSession, user: AdminUser) -> BenefitPackage:
    return await BenefitPackageService(session, user).create(payload)


@router.patch("/{package_id}", response_model=BenefitPackage, operation_id="updateBenefitPackage")
async def update_package(
    package_id: str, payload: UpdateBenefitPackageInput, session: DbSession, user: AdminUser
) -> BenefitPackage:
    return await BenefitPackageService(session, user).update(package_id, payload)


@router.delete("/{package_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="deleteBenefitPackage")
async def delete_package(
    package_id: str, expected_revision: Annotated[int, Query(ge=1)], session: DbSession, user: AdminUser
) -> Response:
    await BenefitPackageService(session, user).delete(package_id, expected_revision)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
