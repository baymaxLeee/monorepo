"""RUM ingestion request schemas."""

import json
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

EventType = Literal["perform", "error", "warning", "event"]
MAX_PAYLOAD_BYTES = 64 * 1024


def _validate_json_value(value: Any) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("payload numbers must be finite")
    if isinstance(value, dict):
        for key, item in value.items():
            if len(str(key)) > 256:
                raise ValueError("payload keys must not exceed 256 characters")
            _validate_json_value(item)
    elif isinstance(value, list):
        for item in value:
            _validate_json_value(item)


class RumEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: EventType
    ts_client: int | None = None
    trace_id: str | None = None
    route: str = Field(default="", max_length=256)
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("payload")
    @classmethod
    def validate_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        _validate_json_value(value)
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
        if len(encoded) > MAX_PAYLOAD_BYTES:
            raise ValueError(f"payload must not exceed {MAX_PAYLOAD_BYTES} bytes")
        return value

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
    release: str = Field(default="", max_length=128)
    device_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    user_agent: str = Field(default="", max_length=512)
    events: list[RumEvent] = Field(min_length=1, max_length=100)
