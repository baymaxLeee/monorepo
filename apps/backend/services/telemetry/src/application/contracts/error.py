"""Error query schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ErrorEvent(BaseModel):
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
    fingerprint: str
    name: str
    message: str
    stack: str
    payload: dict[str, Any]


class ErrorListResponse(BaseModel):
    items: list[ErrorEvent]
