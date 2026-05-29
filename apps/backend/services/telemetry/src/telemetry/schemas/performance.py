"""Performance query schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class PerformanceEvent(BaseModel):
    ts_server: datetime
    app: str
    release: str
    user_id: str | None
    username: str | None
    is_admin: bool
    device_id: str
    session_id: str
    trace_id: str | None
    route: str
    metric: str
    value: float
    payload: dict[str, Any]


class PerformanceListResponse(BaseModel):
    items: list[PerformanceEvent]
