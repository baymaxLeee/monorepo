"""Deployment safety configuration tests."""

import os
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from bootstrap.config import Settings


class TestSettings:
    def test_deployed_environment_accepts_rpc_transport_without_shared_tokens(self):
        with patch.dict(os.environ, {}, clear=True), patch.dict(Settings.model_config, {"env_file": None}):
            settings = Settings(
                environment="single-vps",
                postgres_host="postgres",
                postgres_password="test-database-password",
                admin_rpc_target="admin:9001",
                storage_rpc_target="storage:9013",
            )
        assert settings.admin_rpc_target == "admin:9001"
        assert settings.storage_rpc_target == "storage:9013"

    def test_insecure_deployed_database_fails_closed(self):
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.dict(Settings.model_config, {"env_file": None}),
            pytest.raises(ValidationError),
        ):
            Settings(environment="single-vps")
