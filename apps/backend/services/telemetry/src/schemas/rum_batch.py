"""RUM ingestion request schemas."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

EventType = Literal["perform", "error", "warning", "event"]


class RumEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: EventType
    ts_client: int | None = None
    trace_id: str | None = None
    route: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("trace_id")
    @classmethod
    def validate_trace_id(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if len(value) == 32 and all(c in "0123456789abcdefABCDEF" for c in value):
            return value.lower()
        return None


class RumBatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    app: Literal["platform", "mfe-admin"]
    release: str = ""
    device_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    user_agent: str = ""
    events: list[RumEvent] = Field(min_length=1, max_length=100)
