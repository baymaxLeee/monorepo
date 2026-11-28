"""Deployment safety configuration tests."""

import os
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from bootstrap.config import Settings


class TestSettings:
    def test_converted_markdown_limit_is_large_document_sized(self):
        with patch.dict(os.environ, {}, clear=True), patch.dict(Settings.model_config, {"env_file": None}):
            settings = Settings()
            assert settings.converted_markdown_max_chars == 2_000_000
            with pytest.raises(ValidationError):
                Settings(converted_markdown_max_chars=12_000)

    def test_deployed_environment_requires_a_strong_runtime_workload_credential(self):
        with patch.dict(os.environ, {}, clear=True), patch.dict(Settings.model_config, {"env_file": None}):
            settings = Settings(
                environment="single-vps",
                postgres_host="postgres",
                postgres_password="test-database-password",
                admin_rpc_target="admin:9001",
                storage_rpc_target="storage:9013",
                internal_api_token="strong-knowledge-internal-token-value",
                internal_service_tokens={"runtime": "strong-runtime-internal-token-value"},
            )
        assert settings.admin_rpc_target == "admin:9001"
        assert settings.storage_rpc_target == "storage:9013"
        assert settings.runtime_caller_token == "strong-runtime-internal-token-value"

    def test_insecure_deployed_database_fails_closed(self):
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.dict(Settings.model_config, {"env_file": None}),
            pytest.raises(ValidationError),
        ):
            Settings(environment="single-vps")

    def test_deployed_environment_rejects_missing_or_forged_runtime_token_map(self):
        with patch.dict(os.environ, {}, clear=True), patch.dict(Settings.model_config, {"env_file": None}):
            for tokens in ({}, {"runtime": "short"}, {"runtime": "x" * 32, "gateway": "y" * 32}):
                with pytest.raises(ValidationError):
                    Settings(
                        environment="single-vps",
                        postgres_host="postgres",
                        postgres_password="test-database-password",
                        internal_service_tokens=tokens,
                    )
