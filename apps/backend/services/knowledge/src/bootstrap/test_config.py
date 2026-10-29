"""Production caller credentials follow the declared transport bindings."""

import json
import os
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from bootstrap.config import Settings


class TestSettings:
    def settings(self, tokens: dict[str, str]) -> Settings:
        with patch.dict(os.environ, {}, clear=True), patch.dict(Settings.model_config, {"env_file": None}):
            return Settings(
                environment="single-vps",
                postgres_host="postgres",
                postgres_password="test-database-password",
                internal_api_token="k" * 48,
                internal_service_tokens=tokens,
            )

    def test_declared_callers_start_in_deployed_environment(self):
        tokens = {"chat": "c" * 48, "executor": "e" * 48}
        assert self.settings(tokens).internal_service_tokens == tokens

    def test_invalid_credentials_fail_closed(self):
        invalid = [
            {},
            {"chat": "c" * 48},
            {"chat": "c" * 48, "executor": "e" * 48, "canvas": "v" * 48},
            {"chat": "short", "executor": "e" * 48},
            {"chat": "c" * 48, "executor": "c" * 48},
            {"chat": "dev-" + "c" * 48, "executor": "e" * 48},
        ]
        for tokens in invalid:
            with pytest.raises(ValidationError):
                self.settings(tokens)

    def test_environment_json_reaches_settings(self):
        env = {
            "ENVIRONMENT": "single-vps",
            "POSTGRES_HOST": "postgres",
            "POSTGRES_PASSWORD": "test-database-password",
            "INTERNAL_API_TOKEN": "k" * 48,
            "INTERNAL_SERVICE_TOKENS": json.dumps({"chat": "c" * 48, "executor": "e" * 48}),
        }
        with patch.dict(os.environ, env, clear=True), patch.dict(Settings.model_config, {"env_file": None}):
            assert set(Settings().internal_service_tokens) == {"chat", "executor"}
