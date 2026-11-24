#!/usr/bin/env python3
"""Validate live production inner-service credentials without printing them."""

from __future__ import annotations

import base64
import json
import sys
from typing import Any


class IdentityError(Exception):
    pass


OUTBOUND_SECRETS = {
    "admin": "admin-secrets",
    "canvas": "canvas-secrets",
    "chat": "chat-secrets",
    "knowledge": "knowledge-secrets",
    "runtime": "runtime-server-secrets",
}
RECEIVER_MAPS = {
    "admin-secrets": {"canvas": "canvas", "chat": "chat", "knowledge": "knowledge"},
    "canvas-secrets": {"runtime": "runtime"},
    "knowledge-secrets": {"runtime": "runtime"},
    "runtime-server-secrets": {"chat": "chat"},
    "runtime-worker-secrets": {"runtime": "runtime"},
    "runtime-sandbox-secrets": {"runtime": "runtime"},
    "storage-secrets": {
        "admin": "admin",
        "canvas": "canvas",
        "knowledge": "knowledge",
        "runtime": "runtime",
    },
}
REQUIRED_SECRETS = set(OUTBOUND_SECRETS.values()) | set(RECEIVER_MAPS) | {"runtime-worker-secrets"}


def decode_value(secret_name: str, key: str, data: dict[str, Any]) -> str:
    encoded = data.get(key)
    if not isinstance(encoded, str) or not encoded:
        raise IdentityError(f"{secret_name} is missing required key {key}")
    try:
        value = base64.b64decode(encoded, validate=True).decode()
    except (ValueError, UnicodeDecodeError) as error:
        raise IdentityError(f"{secret_name} has invalid encoded data for {key}") from error
    if not value:
        raise IdentityError(f"{secret_name} has an empty value for {key}")
    return value


def load_secrets(document: Any) -> dict[str, dict[str, Any]]:
    items = document.get("items") if isinstance(document, dict) else None
    if not isinstance(items, list):
        raise IdentityError("expected a Kubernetes SecretList JSON document")
    secrets: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict) or item.get("kind") != "Secret":
            continue
        name = item.get("metadata", {}).get("name")
        if isinstance(name, str):
            secrets[name] = item.get("data", {})
    missing = REQUIRED_SECRETS - set(secrets)
    if missing:
        raise IdentityError(f"missing required production Secrets: {', '.join(sorted(missing))}")
    return secrets


def validate(document: Any) -> None:
    secrets = load_secrets(document)
    outbound = {
        caller: decode_value(secret_name, "INTERNAL_API_TOKEN", secrets[secret_name])
        for caller, secret_name in OUTBOUND_SECRETS.items()
    }
    if len(set(outbound.values())) != len(outbound):
        raise IdentityError("outbound service identity tokens must be unique per caller")
    worker_token = decode_value("runtime-worker-secrets", "INTERNAL_API_TOKEN", secrets["runtime-worker-secrets"])
    if worker_token != outbound["runtime"]:
        raise IdentityError("runtime-worker-secrets INTERNAL_API_TOKEN does not match runtime-server-secrets")

    for secret_name, expected_callers in RECEIVER_MAPS.items():
        raw = decode_value(secret_name, "INTERNAL_SERVICE_TOKENS", secrets[secret_name])
        try:
            tokens = json.loads(raw)
        except json.JSONDecodeError as error:
            raise IdentityError(f"{secret_name} INTERNAL_SERVICE_TOKENS is not valid JSON") from error
        if not isinstance(tokens, dict) or set(tokens) != set(expected_callers):
            raise IdentityError(
                f"{secret_name} INTERNAL_SERVICE_TOKENS must contain exactly: {', '.join(sorted(expected_callers))}"
            )
        for receiver_key, caller in expected_callers.items():
            if tokens.get(receiver_key) != outbound[caller]:
                raise IdentityError(
                    f"{secret_name} INTERNAL_SERVICE_TOKENS entry {receiver_key} "
                    f"does not match {OUTBOUND_SECRETS[caller]} INTERNAL_API_TOKEN"
                )


def main() -> int:
    try:
        validate(json.load(sys.stdin))
    except (IdentityError, json.JSONDecodeError) as error:
        print(f"service identity preflight failed: {error}", file=sys.stderr)
        return 1
    print(f"service identity preflight passed for {len(REQUIRED_SECRETS)} production Secrets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
