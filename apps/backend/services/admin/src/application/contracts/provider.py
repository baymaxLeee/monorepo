"""Model provider API schemas.

Two distinct views exist:

- `ModelProvider`     — public/admin-MFE response. `api_key` is **masked**
                        ("sk-xxxx****xxxx"); the raw key never leaves the
                        admin process.
- `InternalModelProvider` — emitted by `/internal/providers/{id}` only.
                        Contains the decrypted `api_key` for consumer
                        services (chat, etc). Never expose this in the
                        public OpenAPI surface.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl, model_validator

ProviderKind = Literal["chat", "image", "video", "embedding", "rerank"]


class ModelProvider(BaseModel):
    """Public view: masked api_key, safe to serve to admin MFE / browser."""

    id: str
    user_id: str
    org_id: str
    name: str
    model: str
    provider_kind: ProviderKind
    base_url: str
    api_key_masked: str
    extra_body: dict[str, Any]
    context_window: int
    max_output_tokens: int
    supports_image_input: bool
    is_default: bool
    is_enabled: bool
    created_at: str
    updated_at: str


class InternalModelProvider(BaseModel):
    """Internal view: decrypted api_key. Service-to-service only."""

    id: str
    user_id: str
    name: str
    model: str
    provider_kind: ProviderKind
    base_url: str
    api_key: str
    extra_body: dict[str, Any]
    context_window: int
    max_output_tokens: int
    supports_image_input: bool
    is_default: bool
    is_enabled: bool


class CreateModelProviderInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=128)
    provider_kind: ProviderKind = "chat"
    base_url: HttpUrl
    api_key: str = Field(min_length=1, max_length=4096)
    extra_body: dict[str, Any] = Field(default_factory=dict)
    context_window: int = Field(default=524_288, ge=1024, le=2_000_000)
    max_output_tokens: int = Field(default=262_144, ge=256, le=1_000_000)
    supports_image_input: bool = False
    is_default: bool = False
    is_enabled: bool = True

    @model_validator(mode="after")
    def validate_token_budget(self) -> CreateModelProviderInput:
        if self.max_output_tokens >= self.context_window:
            raise ValueError("max_output_tokens must be less than context_window")
        return self


class UpdateModelProviderInput(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    model: str | None = Field(default=None, min_length=1, max_length=128)
    provider_kind: ProviderKind | None = None
    base_url: HttpUrl | None = None
    api_key: str | None = Field(default=None, min_length=1, max_length=4096)
    extra_body: dict[str, Any] | None = None
    context_window: int | None = Field(default=None, ge=1024, le=2_000_000)
    max_output_tokens: int | None = Field(default=None, ge=256, le=1_000_000)
    supports_image_input: bool | None = None
    is_default: bool | None = None
    is_enabled: bool | None = None


class TestModelProviderInput(BaseModel):
    """Optional override; if omitted, tests the persisted configuration."""

    model: str | None = None
    base_url: HttpUrl | None = None
    api_key: str | None = None


class TestModelProviderResult(BaseModel):
    ok: bool
    latency_ms: int | None = None
    sample: str | None = None
    error: str | None = None


class BulkDeleteModelProvidersInput(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=100)


class BulkDeleteModelProvidersResult(BaseModel):
    deleted: int
