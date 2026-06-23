"""Agent runtime schemas."""

from typing import Literal

from pydantic import BaseModel, Field

ReasoningEffort = Literal["low", "medium", "high"]


class RunAgentInput(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    provider_id: str | None = Field(default=None, max_length=32)
    multimodal_provider_id: str | None = Field(
        default=None,
        max_length=32,
        description="Optional provider used by multimodal tools such as image analysis.",
    )
    document_ids: list[str] = Field(default_factory=list, max_length=10)
    thinking: bool | None = Field(
        default=None,
        description="Enable chain-of-thought reasoning when the model supports it.",
    )
    reasoning_effort: ReasoningEffort | None = Field(
        default=None,
        description="Reasoning compute budget for thinking-enabled models.",
    )
