"""Service configuration from environment / .env."""

from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "single-vps", "production"]

_INSECURE_PASSWORDS: frozenset[str] = frozenset({"", "dev", "password", "admin"})

_DEV_ADMIN_SECRET_KEY = "MFnLpzWN-y-Hh0aJtaxKXh4uOFcljnPC6FwpDF4S5Y8="
_DEV_INTERNAL_API_TOKEN = "dev-internal-token"


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

    internal_api_token: str = _DEV_INTERNAL_API_TOKEN

    @computed_field  # type: ignore[prop-decorator]
    @property
    def database_url(self) -> str:
        user = quote_plus(self.postgres_user)
        password = quote_plus(self.postgres_password)
        return f"postgresql+asyncpg://{user}:{password}@{self.postgres_host}:{self.postgres_port}/{self.postgres_database}"

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
        if self.postgres_password.strip().lower() in _INSECURE_PASSWORDS:
            missing.append("POSTGRES_PASSWORD")
        if self.postgres_host in {"localhost", "127.0.0.1"}:
            missing.append("POSTGRES_HOST")
        if self.redis_host in {"localhost", "127.0.0.1"}:
            missing.append("REDIS_HOST")
        if self.admin_secret_key == _DEV_ADMIN_SECRET_KEY:
            missing.append("ADMIN_SECRET_KEY")
        if self.internal_api_token == _DEV_INTERNAL_API_TOKEN:
            missing.append("INTERNAL_API_TOKEN")
        if missing:
            raise ValueError("production environment requires explicit values for: " + ", ".join(missing))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
