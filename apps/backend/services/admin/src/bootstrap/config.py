"""Service configuration from environment / .env."""

from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import Field, computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "single-vps", "production"]

_INSECURE_PASSWORDS: frozenset[str] = frozenset({"", "dev", "password", "admin"})

_DEV_ADMIN_SECRET_KEY = "MFnLpzWN-y-Hh0aJtaxKXh4uOFcljnPC6FwpDF4S5Y8="
_DEV_CALLER_TOKEN = "dev-admin-internal-token"
_DEV_INTERNAL_SERVICE_TOKENS = {
    "canvas": "dev-canvas-internal-token",
    "chat": "dev-chat-internal-token",
    "executor": "dev-executor-internal-token",
    "knowledge": "dev-knowledge-internal-token",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Environment = "development"
    port: int = 8001

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "admin"
    postgres_password: str = "admin"
    postgres_database: str = "admin"

    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0

    admin_secret_key: str = _DEV_ADMIN_SECRET_KEY
    asset_service_url: str = "http://localhost:8013"
    internal_api_token: str = _DEV_CALLER_TOKEN
    asset_claim_dispatch_interval_seconds: float = Field(default=5.0, ge=1.0, le=300.0)
    skill_archive_max_bytes: int = Field(default=256 * 1024 * 1024, gt=0)
    skill_archive_max_expanded_bytes: int = Field(default=512 * 1024 * 1024, gt=0)
    skill_archive_max_member_bytes: int = Field(default=32 * 1024 * 1024, gt=0)

    internal_service_tokens: dict[str, str] = Field(default_factory=lambda: dict(_DEV_INTERNAL_SERVICE_TOKENS))

    @computed_field  # type: ignore[prop-decorator]
    @property
    def database_url(self) -> str:
        user = quote_plus(self.postgres_user)
        password = quote_plus(self.postgres_password)
        return (
            f"postgresql+asyncpg://{user}:{password}@{self.postgres_host}:{self.postgres_port}/{self.postgres_database}"
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def redis_url(self) -> str:
        return f"redis://{self.redis_host}:{self.redis_port}/{self.redis_db}"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @model_validator(mode="after")
    def _enforce_production_safety(self) -> Settings:
        missing: list[str] = []
        if self.environment != "development":
            if len(self.internal_api_token) < 32 or self.internal_api_token.startswith("dev-"):
                missing.append("INTERNAL_API_TOKEN")
            expected_callers = set(_DEV_INTERNAL_SERVICE_TOKENS)
            tokens = self.internal_service_tokens
            if (
                set(tokens) != expected_callers
                or any(len(token) < 32 or token.startswith("dev-") for token in tokens.values())
                or len(set(tokens.values())) != len(tokens)
            ):
                missing.append("INTERNAL_SERVICE_TOKENS")
        if self.environment != "development":
            if self.postgres_password.strip().lower() in _INSECURE_PASSWORDS:
                missing.append("POSTGRES_PASSWORD")
            if self.postgres_host in {"localhost", "127.0.0.1"}:
                missing.append("POSTGRES_HOST")
            if self.redis_host in {"localhost", "127.0.0.1"}:
                missing.append("REDIS_HOST")
            if self.admin_secret_key == _DEV_ADMIN_SECRET_KEY:
                missing.append("ADMIN_SECRET_KEY")
        if missing:
            raise ValueError("deployed environment requires explicit values for: " + ", ".join(missing))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
