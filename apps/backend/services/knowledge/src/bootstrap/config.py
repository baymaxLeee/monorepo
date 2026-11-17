"""Service configuration."""

from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import Field, computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "single-vps", "production"]
_INSECURE_PASSWORDS: frozenset[str] = frozenset({"", "dev", "password", "admin", "workflow", "postgres", "knowledge"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Environment = "development"
    port: int = 8010
    rpc_port: int = 9010

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "knowledge"
    postgres_password: str = "knowledge"
    postgres_database: str = "knowledge"

    admin_rpc_target: str = "localhost:9001"
    storage_rpc_target: str = "localhost:9013"

    media_max_object_bytes: int = 512 * 1024 * 1024
    attachment_max_upload_bytes: int = 10 * 1024 * 1024
    attachment_markdown_max_chars: int = 12_000
    attachment_vision_max_tokens: int = 1024
    ingest_max_parallel: int = Field(default=3, ge=1, le=32)
    ingest_max_files: int = Field(default=20, ge=1, le=100)
    ingest_max_batch_bytes: int = Field(default=30 * 1024 * 1024, gt=0)
    storage_claim_dispatch_interval_seconds: float = Field(default=5.0, ge=1.0, le=300.0)
    llm_timeout_seconds: float = 60.0

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

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @model_validator(mode="after")
    def _enforce_production_safety(self) -> Settings:
        missing: list[str] = []
        if self.ingest_max_batch_bytes < self.attachment_max_upload_bytes:
            raise ValueError("INGEST_MAX_BATCH_BYTES must be at least ATTACHMENT_MAX_UPLOAD_BYTES")
        if self.environment != "development":
            if self.postgres_password.strip().lower() in _INSECURE_PASSWORDS:
                missing.append("POSTGRES_PASSWORD")
            if self.postgres_host in {"localhost", "127.0.0.1"}:
                missing.append("POSTGRES_HOST")
        if missing:
            raise ValueError("deployed environment requires explicit values for: " + ", ".join(missing))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
