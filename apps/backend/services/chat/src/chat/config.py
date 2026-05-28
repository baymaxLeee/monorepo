"""Service configuration from environment / .env."""

from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "single-vps", "production"]

# Defaults that MUST NOT leak into staging/production.
_INSECURE_PASSWORDS: frozenset[str] = frozenset({"", "dev", "password", "admin"})
_DEV_INTERNAL_API_TOKEN = "dev-internal-token"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Environment = "development"
    port: int = 8009

    mysql_host: str = "localhost"
    mysql_port: int = 3306
    mysql_user: str = "dev"
    mysql_password: str = "dev"
    mysql_database: str = "chat"

    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 2

    # Admin owns the model_providers domain. chat fetches decrypted
    # credentials from `${admin_service_url}/internal/providers/...` using
    # the shared `internal_api_token`. Never expose either to the browser.
    admin_service_url: str = "http://localhost:8001"
    internal_api_token: str = _DEV_INTERNAL_API_TOKEN

    # Upstream LLM call timeout (seconds).
    llm_timeout_seconds: float = 60.0
    # How long to cache a decrypted provider snapshot in-process. Five
    # minutes balances "admin can rotate keys without restarts" with
    # "don't hammer admin on every streamed reply chunk".
    provider_cache_ttl_seconds: float = 300.0
    provider_cache_size: int = 256

    @computed_field  # type: ignore[prop-decorator]
    @property
    def database_url(self) -> str:
        user = quote_plus(self.mysql_user)
        password = quote_plus(self.mysql_password)
        return f"mysql+asyncmy://{user}:{password}@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def redis_url(self) -> str:
        return f"redis://{self.redis_host}:{self.redis_port}/{self.redis_db}"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @model_validator(mode="after")
    def _enforce_production_safety(self) -> Settings:
        if self.environment != "production":
            return self
        missing: list[str] = []
        if self.mysql_password.strip().lower() in _INSECURE_PASSWORDS:
            missing.append("MYSQL_PASSWORD")
        if self.mysql_host in {"localhost", "127.0.0.1"}:
            missing.append("MYSQL_HOST")
        if self.redis_host in {"localhost", "127.0.0.1"}:
            missing.append("REDIS_HOST")
        if self.internal_api_token == _DEV_INTERNAL_API_TOKEN:
            missing.append("INTERNAL_API_TOKEN")
        if self.admin_service_url.startswith(("http://localhost", "http://127.")):
            missing.append("ADMIN_SERVICE_URL")
        if missing:
            raise ValueError("production environment requires explicit values for: " + ", ".join(missing))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
