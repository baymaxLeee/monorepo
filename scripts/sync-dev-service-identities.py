#!/usr/bin/env python3
"""Migrate and validate local development service identity credentials.

Only the retired shared development placeholder is rewritten automatically.
Explicit custom credentials are preserved and must already agree across caller
and receiver .env files.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVICE_ROOT = ROOT / "apps" / "backend" / "services"
LEGACY_SHARED_TOKEN = "dev-internal-token"
DEFAULT_CALLER_TOKENS = {
    "admin": "dev-admin-internal-token",
    "canvas": "dev-canvas-internal-token",
    "chat": "dev-chat-internal-token",
    "executor": "dev-executor-internal-token",
    "knowledge": "dev-knowledge-internal-token",
}
RECEIVER_CALLERS = {
    "admin": ("canvas", "chat", "executor", "knowledge"),
    "canvas": ("chat", "executor"),
    "executor": ("canvas", "chat", "knowledge"),
    "knowledge": ("canvas", "chat", "executor"),
    "asset": ("admin", "canvas", "chat", "executor", "knowledge"),
}
ASSIGNMENT = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")


def read_env(path: Path) -> tuple[list[str], dict[str, str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    values: dict[str, str] = {}
    for line in lines:
        match = ASSIGNMENT.match(line)
        if match:
            values[match.group(1)] = match.group(2)
    return lines, values


def set_value(lines: list[str], key: str, value: str) -> list[str]:
    replacement = f"{key}={value}"
    for index, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[index] = replacement
            return lines
    if lines and lines[-1] != "":
        lines.append("")
    lines.append(replacement)
    return lines


def local_envs() -> dict[str, Path]:
    return {
        service: SERVICE_ROOT / service / ".env"
        for service in set(DEFAULT_CALLER_TOKENS) | set(RECEIVER_CALLERS)
    }


def migrate_legacy_tokens(paths: dict[str, Path]) -> None:
    for service, expected in DEFAULT_CALLER_TOKENS.items():
        path = paths[service]
        if not path.is_file():
            continue
        lines, values = read_env(path)
        if values.get("ENVIRONMENT", "development") != "development":
            continue
        if values.get("INTERNAL_API_TOKEN") != LEGACY_SHARED_TOKEN:
            continue
        set_value(lines, "INTERNAL_API_TOKEN", expected)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(
            f"  migrated {path.relative_to(ROOT)} from the retired shared development token"
        )


def current_caller_tokens(paths: dict[str, Path]) -> tuple[dict[str, str], list[str]]:
    tokens: dict[str, str] = {}
    errors: list[str] = []
    for service, fallback in DEFAULT_CALLER_TOKENS.items():
        path = paths[service]
        if not path.is_file():
            tokens[service] = fallback
            continue
        _, values = read_env(path)
        if values.get("ENVIRONMENT", "development") != "development":
            continue
        token = values.get("INTERNAL_API_TOKEN", fallback).strip()
        if not token:
            errors.append(f"{path.relative_to(ROOT)} has an empty INTERNAL_API_TOKEN")
            continue
        if token == LEGACY_SHARED_TOKEN:
            errors.append(
                f"{path.relative_to(ROOT)} still uses the retired shared development token"
            )
        tokens[service] = token
    return tokens, errors


def sync_receiver_maps(
    paths: dict[str, Path], caller_tokens: dict[str, str], fix: bool
) -> list[str]:
    errors: list[str] = []
    for receiver, callers in RECEIVER_CALLERS.items():
        path = paths[receiver]
        if not path.is_file():
            continue
        lines, values = read_env(path)
        if values.get("ENVIRONMENT", "development") != "development":
            continue
        expected = {caller: caller_tokens[caller] for caller in callers}
        raw = values.get("INTERNAL_SERVICE_TOKENS")
        if raw is None and fix:
            set_value(
                lines,
                "INTERNAL_SERVICE_TOKENS",
                json.dumps(expected, separators=(",", ":")),
            )
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            print(f"  added caller map to {path.relative_to(ROOT)}")
            continue
        if raw is None:
            errors.append(
                f"{path.relative_to(ROOT)} is missing INTERNAL_SERVICE_TOKENS"
            )
            continue
        try:
            actual = json.loads(raw)
        except json.JSONDecodeError:
            errors.append(
                f"{path.relative_to(ROOT)} has invalid INTERNAL_SERVICE_TOKENS JSON"
            )
            continue
        if actual != expected:
            errors.append(
                f"{path.relative_to(ROOT)} INTERNAL_SERVICE_TOKENS does not match current caller credentials"
            )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--fix",
        action="store_true",
        help="migrate only known legacy development placeholders",
    )
    args = parser.parse_args()
    paths = local_envs()
    if args.fix:
        migrate_legacy_tokens(paths)
    caller_tokens, errors = current_caller_tokens(paths)
    errors.extend(sync_receiver_maps(paths, caller_tokens, args.fix))
    if errors:
        for error in errors:
            print(f"✗ {error}", file=sys.stderr)
        print(
            "  Run: python3 scripts/sync-dev-service-identities.py --fix",
            file=sys.stderr,
        )
        return 1
    print("✓ Local development service identities are consistent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
