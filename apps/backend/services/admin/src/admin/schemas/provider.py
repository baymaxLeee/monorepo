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

from typing import Any

from pydantic import BaseModel, Field, HttpUrl


class ModelProvider(BaseModel):
    """Public view: masked api_key, safe to serve to admin MFE / browser."""

    id: str
    user_id: str
    name: str
    model: str
    base_url: str
    api_key_masked: str
    extra_body: dict[str, Any]
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
    base_url: str
    api_key: str
    extra_body: dict[str, Any]
    is_default: bool
    is_enabled: bool


class CreateModelProviderInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=128)
    base_url: HttpUrl
    api_key: str = Field(min_length=1, max_length=4096)
    extra_body: dict[str, Any] = Field(default_factory=dict)
    is_default: bool = False
    is_enabled: bool = True


class UpdateModelProviderInput(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    model: str | None = Field(default=None, min_length=1, max_length=128)
    base_url: HttpUrl | None = None
    # When omitted, the existing encrypted value is preserved. When provided,
    # it MUST be the new plaintext key — the admin re-encrypts on write.
    api_key: str | None = Field(default=None, min_length=1, max_length=4096)
    extra_body: dict[str, Any] | None = None
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
