"""Service configuration."""

from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "single-vps", "production"]
_INSECURE_PASSWORDS: frozenset[str] = frozenset({"", "dev", "password", "admin"})
_DEV_INTERNAL_API_TOKEN = "dev-internal-token"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Environment = "development"
    port: int = 8010

    mysql_host: str = "localhost"
    mysql_port: int = 3306
    mysql_user: str = "dev"
    mysql_password: str = "dev"
    mysql_database: str = "knowledge"

    admin_service_url: str = "http://localhost:8001"
    internal_api_token: str = _DEV_INTERNAL_API_TOKEN

    knowledge_data_dir: str = "./data/objects"
    max_object_bytes: int = 10 * 1024 * 1024
    attachment_max_upload_bytes: int = 10 * 1024 * 1024
    attachment_markdown_max_chars: int = 12_000
    attachment_vision_max_tokens: int = 256
    ingest_max_parallel: int = 3
    llm_timeout_seconds: float = 60.0
    default_bucket: str = "knowledge"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def database_url(self) -> str:
        user = quote_plus(self.mysql_user)
        password = quote_plus(self.mysql_password)
        return f"mysql+asyncmy://{user}:{password}@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"

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
        if self.internal_api_token == _DEV_INTERNAL_API_TOKEN:
            missing.append("INTERNAL_API_TOKEN")
        if missing:
            raise ValueError("production environment requires explicit values for: " + ", ".join(missing))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
