"""Service configuration from environment / .env."""

from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "single-vps", "production"]

_INSECURE_PASSWORDS: frozenset[str] = frozenset({"", "dev", "password", "admin", "telemetry"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Environment = "development"
    port: int = 8008

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "telemetry"
    postgres_password: str = "telemetry"
    postgres_database: str = "telemetry"

    sample_rate_perform: float = 1.0
    sample_rate_event: float = 1.0

    @computed_field  # type: ignore[prop-decorator]
    @property
    def database_url(self) -> str:
        user = quote_plus(self.postgres_user)
        password = quote_plus(self.postgres_password)
        return f"postgresql+asyncpg://{user}:{password}@{self.postgres_host}:{self.postgres_port}/{self.postgres_database}"

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
        if missing:
            raise ValueError("production environment requires explicit values for: " + ", ".join(missing))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
