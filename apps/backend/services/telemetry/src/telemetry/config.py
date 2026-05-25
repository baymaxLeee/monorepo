"""Service configuration from environment / .env."""

from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    port: int = 8008
    environment: Environment = "development"

    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_user: str = "default"
    clickhouse_password: str = ""
    clickhouse_database: str = "telemetry"

    sample_rate_perform: float = 1.0
    sample_rate_event: float = 1.0

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @model_validator(mode="after")
    def _enforce_production_safety(self) -> "Settings":
        if self.environment != "production":
            return self
        missing: list[str] = []
        if self.clickhouse_host in {"localhost", "127.0.0.1"}:
            missing.append("CLICKHOUSE_HOST")
        # default user with empty password is ClickHouse's "no auth" mode;
        # acceptable in dev, never in production.
        if self.clickhouse_user == "default" and self.clickhouse_password == "":
            missing.append("CLICKHOUSE_USER/CLICKHOUSE_PASSWORD")
        if missing:
            raise ValueError(
                "production environment requires explicit values for: "
                + ", ".join(missing)
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
