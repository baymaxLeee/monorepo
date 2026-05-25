"""Service configuration from environment / .env."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    port: int = 8008
    environment: str = "development"

    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_user: str = "default"
    clickhouse_password: str = ""
    clickhouse_database: str = "telemetry"

    sample_rate_perform: float = 1.0
    sample_rate_event: float = 1.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
