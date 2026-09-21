"""Internal benefit-package credential lookup for review workers."""

from typing import Annotated

from application.auth import AuthContext
from application.benefit_packages import BenefitPackageService
from application.contracts.benefit_package import (
    BenefitPackageReviewReservation,
    InternalBenefitPackage,
    ReserveBenefitPackageReviewInput,
)
from fastapi import APIRouter, Header, Query
from kernel.errors import ForbiddenError

from api.http.dependencies import DbSession, InternalCaller

router = APIRouter(prefix="/internal/canvas/benefit-packages", tags=["internal-canvas-benefit-packages"])


def _require_canvas(caller: str) -> None:
    if caller != "canvas":
        raise ForbiddenError("Only Canvas may use benefit package internals")


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
