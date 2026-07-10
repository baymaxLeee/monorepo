"""Operations observability endpoints."""

from typing import Annotated

from deps import CurrentUser
from fastapi import APIRouter, Query
from kernel.errors import ForbiddenError
from schemas.ops import ObservabilityStatusResponse, TraceDetailResponse, TraceListResponse
from services.ops import get_observability_status, get_trace_detail, list_traces

router = APIRouter(prefix="/ops", tags=["ops"])


@router.get("/observability", response_model=ObservabilityStatusResponse)
async def observability_status(current_user: CurrentUser) -> ObservabilityStatusResponse:
    if not current_user.is_admin:
        raise ForbiddenError("super_admin is required")
    return await get_observability_status()


@router.get("/traces", response_model=TraceListResponse)
async def recent_traces(
    current_user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    minutes: Annotated[int, Query(ge=5, le=1440)] = 60,
) -> TraceListResponse:
    if not current_user.is_admin:
        raise ForbiddenError("super_admin is required")
    return await list_traces(limit=limit, minutes=minutes)


@router.get("/traces/{trace_id}", response_model=TraceDetailResponse)
async def trace_detail(current_user: CurrentUser, trace_id: str) -> TraceDetailResponse:
    if not current_user.is_admin:
        raise ForbiddenError("super_admin is required")
    return await get_trace_detail(trace_id)
