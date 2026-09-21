"""Internal benefit-package credential lookup for review workers."""

from typing import Annotated

from application.auth import AuthContext
from application.benefit_packages import BenefitPackageService
from application.contracts.benefit_package import InternalBenefitPackage
from fastapi import APIRouter, Header, Query
from kernel.errors import ForbiddenError

from api.http.dependencies import DbSession, InternalCaller

router = APIRouter(prefix="/internal/canvas/benefit-packages", tags=["internal-canvas-benefit-packages"])


@router.get("/{package_id}", response_model=InternalBenefitPackage)
async def get_benefit_package_internal(
    package_id: str,
    workspace_id: Annotated[str, Query(min_length=1)],
    tenant_id: Annotated[str, Query(min_length=1)],
    session: DbSession,
    _caller: InternalCaller,
    caller: Annotated[str, Header(alias="X-Caller-Service")],
) -> InternalBenefitPackage:
    if caller != "canvas":
        raise ForbiddenError("Only Canvas may resolve benefit package credentials")
    user = AuthContext(user_id="", username="", email="", workspace_id=workspace_id, tenant_id=tenant_id)
    return await BenefitPackageService(session, user).get_internal(package_id)
