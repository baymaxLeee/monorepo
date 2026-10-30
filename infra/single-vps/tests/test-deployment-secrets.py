"""Deployment credentials must reach every receiver and survive re-rendering."""

import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[3]
VPS = ROOT / "infra/single-vps"


class DeploymentSecretsTest(unittest.TestCase):
    def test_service_check_rejects_receiver_drift(self):
        spec = importlib.util.spec_from_file_location(
            "check_services", ROOT / "scripts/check-services.py"
        )
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        services = checker.load_services()
        checker.validate_service_identities(services)
        for tokens in (
            {"chat": "${CHAT_INTERNAL_API_TOKEN:?required}"},
            {
                "chat": "${CHAT_INTERNAL_API_TOKEN:?required}",
                "executor": "${CHAT_INTERNAL_API_TOKEN:?required}",
            },
        ):
            compose = yaml.safe_load((VPS / "docker-compose.prod.yml").read_text())
            compose["services"]["knowledge"]["environment"][
                "INTERNAL_SERVICE_TOKENS"
            ] = json.dumps(tokens)
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "compose.yml"
                path.write_text(yaml.safe_dump(compose))
                with (
                    patch.object(checker, "SINGLE_VPS_PATH", path),
                    contextlib.redirect_stderr(io.StringIO()),
                ):
                    with self.assertRaises(SystemExit):
                        checker.validate_service_identities(services)

    def test_rollback_can_pin_migration_image_independently(self):
        compose = VPS / "docker-compose.prod.yml"
        required = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*):\?", compose.read_text()))
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / "compose.env"
            env_file.write_text("\n".join(f"{key}=test-only" for key in required))
            env = {
                **os.environ,
                "IMAGE_REGISTRY": "example.invalid/test",
                "IMAGE_TAG": "old-app",
                "PUBLIC_PORT": "8080",
            }
            env.pop("DB_INIT_IMAGE_TAG", None)
            for migration_tag in (None, "new-schema"):
                if migration_tag:
                    env["DB_INIT_IMAGE_TAG"] = migration_tag
                result = subprocess.run(
                    [
                        "docker",
                        "compose",
                        "--env-file",
                        str(env_file),
                        "-f",
                        str(compose),
                        "config",
                        "--format",
                        "json",
                    ],
                    env=env,
                    capture_output=True,
                    text=True,
                    check=True,
                )
                services = json.loads(result.stdout)["services"]
                self.assertEqual(
                    services["canvas"]["image"], "example.invalid/test/canvas:old-app"
                )
                self.assertEqual(
                    services["db-init"]["image"],
                    f"example.invalid/test/db-init:{migration_tag or 'old-app'}",
                )

    def test_signing_key_is_generated_once(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            shutil.copy(VPS / "render-env.sh", path)
            (path / ".env.secrets").write_text("EXISTING_KEY=keep-me\n")
            (path / "age.key").touch()
            (path / "secrets.sops.env").touch()
            (path / "sops").write_text("#!/bin/sh\nexit 0\n")
            (path / "sops").chmod(0o700)
            env = dict(
                os.environ,
                PATH=f"{path}:{os.environ['PATH']}",
                IMAGE_REGISTRY="example.invalid/test",
                IMAGE_TAG="old-app",
                DB_INIT_IMAGE_TAG="new-schema",
                PUBLIC_GATEWAY_URL="https://example.invalid",
                SOPS_AGE_KEY_FILE=str(path / "age.key"),
            )

            def render():
                subprocess.run(
                    ["bash", str(path / "render-env.sh")],
                    env=env,
                    cwd=path,
                    capture_output=True,
                    check=True,
                )
                return dict(
                    line.split("=", 1)
                    for line in (path / ".env.secrets").read_text().splitlines()
                )

            first = render()
            self.assertIn("DB_INIT_IMAGE_TAG=new-schema", (path / ".env").read_text())
            self.assertIn("ASSET_SIGNING_KEY", first)
            self.assertGreaterEqual(len(first["ASSET_SIGNING_KEY"]), 32)
            self.assertEqual(render(), first)
            self.assertIn(
                f"ASSET_SIGNING_KEY={first['ASSET_SIGNING_KEY']}",
                (path / ".env").read_text(),
            )
            self.assertEqual((path / ".env.secrets").stat().st_mode & 0o777, 0o600)

    def test_compose_injects_credentials(self):
        source = (VPS / "docker-compose.prod.yml").read_text()
        keys = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*):\?", source))
        values = {key: hashlib.sha256(key.encode()).hexdigest() for key in keys}
        values.update(
            IMAGE_REGISTRY="example.invalid/test",
            PUBLIC_GATEWAY_URL="https://example.invalid",
        )
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / "test.env"
            env_file.write_text(
                "\n".join(f"{key}={value}" for key, value in values.items())
            )
            result = subprocess.run(
                [
                    "docker",
                    "compose",
                    "--env-file",
                    str(env_file),
                    "-f",
                    str(VPS / "docker-compose.prod.yml"),
                    "config",
                    "--format",
                    "json",
                ],
                env={"PATH": os.environ["PATH"], "HOME": os.environ["HOME"]},
                cwd=directory,
                text=True,
                capture_output=True,
                check=True,
            )
        services = json.loads(result.stdout)["services"]
        with self.subTest(service="asset"):
            self.assertEqual(
                services["asset"]["environment"].get("ASSET_SIGNING_KEY"),
                values.get("ASSET_SIGNING_KEY", "missing-signing-key"),
            )
        with self.subTest(service="knowledge"):
            actual = json.loads(
                services["knowledge"]["environment"]["INTERNAL_SERVICE_TOKENS"]
            )
            expected = {
                caller: values[f"{caller.upper()}_INTERNAL_API_TOKEN"]
                for caller in ("chat", "executor")
            }
            self.assertEqual(actual, expected)

    def test_k8s_secret_templates(self):
        base = ROOT / "infra/k8s/base"
        asset = yaml.safe_load((base / "asset/secret.yaml").read_text())["stringData"]
        knowledge = yaml.safe_load((base / "knowledge/secret.yaml").read_text())[
            "stringData"
        ]
        with self.subTest(service="asset"):
            self.assertIn("ASSET_SIGNING_KEY", asset)
        with self.subTest(service="knowledge"):
            self.assertEqual(
                json.loads(knowledge["INTERNAL_SERVICE_TOKENS"]),
                {
                    caller: f"REPLACE_{caller.upper()}_TOKEN"
                    for caller in ("chat", "executor")
                },
            )


if __name__ == "__main__":
    unittest.main()
