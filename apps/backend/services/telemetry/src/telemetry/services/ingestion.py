"""RUM write-path validation, redaction, sampling, and ClickHouse inserts."""

import hashlib
import json
import random
import re
from datetime import UTC, datetime
from typing import Any

from clickhouse_connect.driver import Client

from telemetry.config import get_settings
from telemetry.deps import OptionalAuthContext
from telemetry.schemas.rum_batch import RumBatch, RumEvent

SENSITIVE_KEY_RE = re.compile(r"(password|token|authorization|cookie|secret)", re.IGNORECASE)


def ingest_batch(client: Client, batch: RumBatch, auth: OptionalAuthContext) -> None:
    settings = get_settings()
    now = datetime.now(UTC)

    perform_rows: list[dict[str, Any]] = []
    error_rows: list[dict[str, Any]] = []
    warning_rows: list[dict[str, Any]] = []
    business_rows: list[dict[str, Any]] = []

    for event in batch.events:
        if event.type == "perform" and not _sample(settings.sample_rate_perform):
            continue
        if event.type == "event" and not _sample(settings.sample_rate_event):
            continue

        common = _common_row(batch, event, auth, now, settings.environment)
        payload = _redact(event.payload)

        if event.type == "perform":
            perform_rows.append(
                {
                    **common,
                    "metric": str(payload.get("metric") or payload.get("name") or "unknown"),
                    "value": _float(payload.get("value")),
                    "payload": _json(payload),
                }
            )
        elif event.type == "error":
            name = str(payload.get("name") or "Error")
            message = str(payload.get("message") or "")
            stack = str(payload.get("stack") or "")
            error_rows.append(
                {
                    **common,
                    "fingerprint": _fingerprint(name, message, stack),
                    "name": name,
                    "message": message,
                    "stack": stack,
                    "payload": _json(payload),
                }
            )
        elif event.type == "warning":
            warning_rows.append(
                {
                    **common,
                    "level": str(payload.get("level") or "warning"),
                    "message": str(payload.get("message") or ""),
                    "payload": _json(payload),
                }
            )
        else:
            business_rows.append(
                {
                    **common,
                    "name": str(payload.get("name") or "event"),
                    "payload": _json(payload),
                }
            )

    _insert(client, "events_perform", perform_rows)
    _insert(client, "events_error", error_rows)
    _insert(client, "events_warning", warning_rows)
    _insert(client, "events_business", business_rows)

    if batch.events:
        _insert(
            client,
            "sessions",
            [
                {
                    "ts_server": now,
                    "app": batch.app,
                    "env": settings.environment,
                    "release": batch.release,
                    "user_id": auth.user_id,
                    "username": auth.username,
                    "is_admin": 1 if auth.is_admin else 0,
                    "device_id": batch.device_id,
                    "session_id": batch.session_id,
                    "route": batch.events[-1].route,
                    "user_agent": batch.user_agent or auth.user_agent,
                    "event_count": len(batch.events),
                }
            ],
        )


def _common_row(
    batch: RumBatch,
    event: RumEvent,
    auth: OptionalAuthContext,
    now: datetime,
    env: str,
) -> dict[str, Any]:
    return {
        "ts_server": now,
        "ts_client": _client_time(event.ts_client),
        "app": batch.app,
        "env": env,
        "release": batch.release,
        "user_id": auth.user_id,
        "username": auth.username,
        "is_admin": 1 if auth.is_admin else 0,
        "device_id": batch.device_id,
        "session_id": batch.session_id,
        "trace_id": event.trace_id,
        "route": event.route,
        "user_agent": batch.user_agent or auth.user_agent,
    }


def _insert(client: Client, table: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    columns = list(rows[0].keys())
    client.insert(table, [[row[column] for column in columns] for row in rows], column_names=columns)


def _client_time(value: int | None) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(value / 1000, UTC)
    except (OSError, OverflowError, ValueError):
        return None


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if SENSITIVE_KEY_RE.search(str(key)):
                redacted[str(key)] = "[REDACTED]"
            else:
                redacted[str(key)] = _redact(item)
        return redacted
    if isinstance(value, list):
        return [_redact(item) for item in value[:50]]
    if isinstance(value, str):
        return value[:8000]
    return value


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _sample(rate: float) -> bool:
    return rate >= 1 or random.random() <= max(rate, 0)


def _float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _fingerprint(name: str, message: str, stack: str) -> str:
    frames = "\n".join(stack.splitlines()[:3])
    normalized = re.sub(r"\\d+", "<n>", message)
    return hashlib.sha256(f"{name}\n{normalized}\n{frames}".encode()).hexdigest()[:32]
