"""Service configuration."""

from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import Field, computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "single-vps", "production"]
_INSECURE_PASSWORDS: frozenset[str] = frozenset({"", "dev", "password", "admin", "workflow", "postgres", "knowledge"})
_DEV_INTERNAL_SERVICE_TOKENS = {
    "canvas": "dev-canvas-internal-token",
    "chat": "dev-chat-internal-token",
    "executor": "dev-executor-internal-token",
}
_DEV_CALLER_TOKEN = "dev-knowledge-internal-token"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Environment = "development"
    port: int = 8010

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "knowledge"
    postgres_password: str = "knowledge"
    postgres_database: str = "knowledge"

    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 3

    admin_service_url: str = "http://localhost:8001"
    executor_service_url: str = "http://localhost:8011"
    internal_api_token: str = _DEV_CALLER_TOKEN
    internal_service_tokens: dict[str, str] = Field(default_factory=lambda: dict(_DEV_INTERNAL_SERVICE_TOKENS))

    knowledge_data_dir: str = "./data/objects"
    max_object_bytes: int = 10 * 1024 * 1024
    media_max_object_bytes: int = 512 * 1024 * 1024
    attachment_max_upload_bytes: int = 10 * 1024 * 1024
    attachment_markdown_max_chars: int = 12_000
    attachment_vision_max_tokens: int = 1024
    ingest_max_parallel: int = Field(default=3, ge=1, le=32)
    ingest_max_files: int = Field(default=20, ge=1, le=100)
    ingest_max_batch_bytes: int = Field(default=30 * 1024 * 1024, gt=0)
    executor_dispatch_interval_seconds: float = 5.0
    executor_dispatch_max_parallel: int = Field(default=16, ge=1, le=100)
    executor_redispatch_after_seconds: float = Field(default=60.0, ge=5.0, le=3600.0)
    llm_timeout_seconds: float = 60.0
    default_bucket: str = "knowledge"

    embedding_dim: int = 2048
    chunk_max_tokens: int = 512
    chunk_overlap_tokens: int = 64
    contextual_retrieval_enabled: bool = True
    contextual_context_max_tokens: int = 128
    retrieval_candidate_k: int = 50
    retrieval_top_k: int = 8
    rrf_k: int = 60
    rerank_enabled: bool = True

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
        if self.ingest_max_batch_bytes < self.attachment_max_upload_bytes:
            raise ValueError("INGEST_MAX_BATCH_BYTES must be at least ATTACHMENT_MAX_UPLOAD_BYTES")
        if self.environment != "development":
            if len(self.internal_api_token) < 32 or self.internal_api_token.startswith("dev-"):
                missing.append("INTERNAL_API_TOKEN")
            tokens = self.internal_service_tokens
            if (
                set(tokens) != set(_DEV_INTERNAL_SERVICE_TOKENS)
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
        if missing:
            raise ValueError("deployed environment requires explicit values for: " + ", ".join(missing))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
