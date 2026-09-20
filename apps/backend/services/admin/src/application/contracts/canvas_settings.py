from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CanvasModelParameters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, ge=0, le=1)
    max_tokens: int | None = Field(default=None, ge=1)
    reasoning_effort: Literal["none", "minimal", "low", "medium", "high", "xhigh"] | None = None


class CanvasModelSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str = Field(min_length=1, max_length=32)
    parameters: CanvasModelParameters = Field(default_factory=CanvasModelParameters)


class CanvasDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")
    inference: CanvasModelSelection | None = None
    image: CanvasModelSelection | None = None
    video: CanvasModelSelection | None = None


class CanvasSettings(BaseModel):
    revision: int
    defaults: CanvasDefaults


class UpdateCanvasSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    defaults: CanvasDefaults
