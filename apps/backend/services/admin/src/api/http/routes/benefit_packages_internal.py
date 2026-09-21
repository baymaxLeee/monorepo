"""Internal benefit-package credential lookup for review workers."""

from typing import Annotated

from application.auth import AuthContext
from application.benefit_packages import BenefitPackageService
from application.contracts.benefit_package import (
    AvailableBenefitPackage,
    BeginBenefitPackageReviewCleanupInput,
    BenefitPackageReviewCleanup,
    BenefitPackageReviewReservation,
    InternalBenefitPackage,
    ReserveBenefitPackageReviewInput,
    ReviewedAsset,
    SubmitReviewedAssetInput,
)
from fastapi import APIRouter, Header, Query
from kernel.errors import ForbiddenError

from api.http.dependencies import DbSession, InternalCaller

router = APIRouter(prefix="/internal/canvas/benefit-packages", tags=["internal-canvas-benefit-packages"])


def _require_canvas(caller: str) -> None:
    if caller != "canvas":
        raise ForbiddenError("Only Canvas may use benefit package internals")


@router.get("", response_model=list[AvailableBenefitPackage], operation_id="listAvailableBenefitPackagesInternal")
async def list_available_benefit_packages_internal(
    workspace_id: Annotated[str, Query(min_length=1)],
    tenant_id: Annotated[str, Query(min_length=1)],
    session: DbSession,
    _caller: InternalCaller,
    caller: Annotated[str, Header(alias="X-Caller-Service")],
) -> list[AvailableBenefitPackage]:
    _require_canvas(caller)
    user = AuthContext(user_id="", username="", email="", workspace_id=workspace_id, tenant_id=tenant_id)
    return await BenefitPackageService(session, user).list_available_internal()


@router.get("/{package_id}", response_model=InternalBenefitPackage)
async def get_benefit_package_internal(
    package_id: str,
    workspace_id: Annotated[str, Query(min_length=1)],
    tenant_id: Annotated[str, Query(min_length=1)],
    session: DbSession,
    _caller: InternalCaller,
    caller: Annotated[str, Header(alias="X-Caller-Service")],
) -> InternalBenefitPackage:
    _require_canvas(caller)
    user = AuthContext(user_id="", username="", email="", workspace_id=workspace_id, tenant_id=tenant_id)
    return await BenefitPackageService(session, user).get_internal(package_id)


@router.post(
    "/{package_id}/review-reservations",
    response_model=BenefitPackageReviewReservation,
    operation_id="reserveBenefitPackageReview",
)
async def reserve_review(
    package_id: str,
    payload: ReserveBenefitPackageReviewInput,
    workspace_id: Annotated[str, Query(min_length=1)],
    tenant_id: Annotated[str, Query(min_length=1)],
    session: DbSession,
    _caller: InternalCaller,
    caller: Annotated[str, Header(alias="X-Caller-Service")],
) -> BenefitPackageReviewReservation:
    _require_canvas(caller)
    user = AuthContext(user_id="", username="", email="", workspace_id=workspace_id, tenant_id=tenant_id)
    return await BenefitPackageService(session, user).reserve_review(package_id, payload)


@router.post(
    "/{package_id}/review-reservations/{reservation_id}/{status}",
    response_model=BenefitPackageReviewReservation,
    operation_id="transitionBenefitPackageReview",
)
async def transition_review(
    package_id: str,
    reservation_id: str,
    status: str,
    workspace_id: Annotated[str, Query(min_length=1)],
    tenant_id: Annotated[str, Query(min_length=1)],
    session: DbSession,
    _caller: InternalCaller,
    caller: Annotated[str, Header(alias="X-Caller-Service")],
) -> BenefitPackageReviewReservation:
    _require_canvas(caller)
    user = AuthContext(user_id="", username="", email="", workspace_id=workspace_id, tenant_id=tenant_id)
    return await BenefitPackageService(session, user).transition_review_reservation(package_id, reservation_id, status)


@router.post(
    "/{package_id}/review-cleanups/{reservation_id}",
    response_model=BenefitPackageReviewCleanup,
    operation_id="beginBenefitPackageReviewCleanup",
)
async def begin_review_cleanup(
    package_id: str,
    reservation_id: str,
    payload: BeginBenefitPackageReviewCleanupInput,
    workspace_id: Annotated[str, Query(min_length=1)],
    tenant_id: Annotated[str, Query(min_length=1)],
    session: DbSession,
    _caller: InternalCaller,
    caller: Annotated[str, Header(alias="X-Caller-Service")],
) -> BenefitPackageReviewCleanup:
    _require_canvas(caller)
    user = AuthContext(user_id="", username="", email="", workspace_id=workspace_id, tenant_id=tenant_id)
    return await BenefitPackageService(session, user).begin_review_cleanup(
        package_id, reservation_id, payload.cleanup_id
    )


@router.post(
    "/{package_id}/review-cleanups/{reservation_id}/{cleanup_id}/complete",
    response_model=BenefitPackageReviewCleanup,
    operation_id="completeBenefitPackageReviewCleanup",
)
async def complete_review_cleanup(
    package_id: str,
    reservation_id: str,
    cleanup_id: str,
    workspace_id: Annotated[str, Query(min_length=1)],
    tenant_id: Annotated[str, Query(min_length=1)],
    session: DbSession,
    _caller: InternalCaller,
    caller: Annotated[str, Header(alias="X-Caller-Service")],
) -> BenefitPackageReviewCleanup:
    _require_canvas(caller)
    user = AuthContext(user_id="", username="", email="", workspace_id=workspace_id, tenant_id=tenant_id)
    return await BenefitPackageService(session, user).complete_review_cleanup(package_id, reservation_id, cleanup_id)


@router.post("/{package_id}/reviewed-assets", response_model=ReviewedAsset, operation_id="submitReviewedAsset")
async def submit_reviewed_asset(
    package_id: str,
    payload: SubmitReviewedAssetInput,
    workspace_id: Annotated[str, Query(min_length=1)],
    tenant_id: Annotated[str, Query(min_length=1)],
    session: DbSession,
    _caller: InternalCaller,
    caller: Annotated[str, Header(alias="X-Caller-Service")],
) -> ReviewedAsset:
    _require_canvas(caller)
    user = AuthContext(user_id="", username="", email="", workspace_id=workspace_id, tenant_id=tenant_id)
    return await BenefitPackageService(session, user).submit_reviewed_asset(package_id, payload)


@router.get("/{package_id}/reviewed-assets/{asset_id}", response_model=ReviewedAsset, operation_id="getReviewedAsset")
async def get_reviewed_asset(
    package_id: str,
    asset_id: str,
    workspace_id: Annotated[str, Query(min_length=1)],
    tenant_id: Annotated[str, Query(min_length=1)],
    session: DbSession,
    _caller: InternalCaller,
    caller: Annotated[str, Header(alias="X-Caller-Service")],
) -> ReviewedAsset:
    _require_canvas(caller)
    user = AuthContext(user_id="", username="", email="", workspace_id=workspace_id, tenant_id=tenant_id)
    return await BenefitPackageService(session, user).get_reviewed_asset(package_id, asset_id)


@router.delete(
    "/{package_id}/reviewed-assets/{asset_id}",
    status_code=204,
    operation_id="deleteReviewedAsset",
)
async def delete_reviewed_asset(
    package_id: str,
    asset_id: str,
    workspace_id: Annotated[str, Query(min_length=1)],
    tenant_id: Annotated[str, Query(min_length=1)],
    session: DbSession,
    _caller: InternalCaller,
    caller: Annotated[str, Header(alias="X-Caller-Service")],
) -> None:
    _require_canvas(caller)
    user = AuthContext(user_id="", username="", email="", workspace_id=workspace_id, tenant_id=tenant_id)
    await BenefitPackageService(session, user).delete_reviewed_asset(package_id, asset_id)
