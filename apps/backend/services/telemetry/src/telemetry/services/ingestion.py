"""RUM write-path validation, redaction, sampling, and MySQL inserts.

All event tables are append-only via ORM `session.add_all`. The `sessions`
table uses `INSERT ... ON DUPLICATE KEY UPDATE` to replicate the ClickHouse
ReplacingMergeTree semantics: multiple batches for the same `(app, session_id)`
merge into one row whose `event_count` accumulates.
"""

import hashlib
import random
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.ext.asyncio import AsyncSession

from telemetry.config import get_settings
from telemetry.deps import OptionalAuthContext
from telemetry.models import (
    EventBusinessRow,
    EventErrorRow,
    EventPerformRow,
    EventWarningRow,
    SessionRow,
)
from telemetry.schemas.rum_batch import RumBatch, RumEvent

SENSITIVE_KEY_RE = re.compile(r"(password|token|authorization|cookie|secret)", re.IGNORECASE)


async def ingest_batch(session: AsyncSession, batch: RumBatch, auth: OptionalAuthContext) -> None:
    settings = get_settings()
    # MySQL DATETIME columns are timezone-naive; we standardize on UTC at
    # write-time and strip tzinfo on the way in.
    now = datetime.now(UTC).replace(tzinfo=None)

    rows: list[Any] = []

    for event in batch.events:
        if event.type == "perform" and not _sample(settings.sample_rate_perform):
            continue
        if event.type == "event" and not _sample(settings.sample_rate_event):
            continue

        common = _common_kwargs(batch, event, auth, now, settings.environment)
        payload = _redact(event.payload)

        if event.type == "perform":
            rows.append(
                EventPerformRow(
                    **common,
                    metric=str(payload.get("metric") or payload.get("name") or "unknown"),
                    value=_float(payload.get("value")),
                    payload=payload,
                )
            )
        elif event.type == "error":
            name = str(payload.get("name") or "Error")
            message = str(payload.get("message") or "")
            stack = str(payload.get("stack") or "")
            rows.append(
                EventErrorRow(
                    **common,
                    fingerprint=_fingerprint(name, message, stack),
                    name=name,
                    message=message,
                    stack=stack,
                    payload=payload,
                )
            )
        elif event.type == "warning":
            rows.append(
                EventWarningRow(
                    **common,
                    level=str(payload.get("level") or "warning"),
                    message=str(payload.get("message") or ""),
                    payload=payload,
                )
            )
        else:
            rows.append(
                EventBusinessRow(
                    **common,
                    name=str(payload.get("name") or "event"),
                    payload=payload,
                )
            )

    if rows:
        session.add_all(rows)

    if batch.events:
        last = batch.events[-1]
        stmt = mysql_insert(SessionRow).values(
            app=batch.app,
            session_id=batch.session_id,
            ts_server=now,
            env=settings.environment,
            release=batch.release,
            user_id=auth.user_id,
            username=auth.username,
            is_admin=1 if auth.is_admin else 0,
            device_id=batch.device_id,
            route=last.route,
            user_agent=batch.user_agent or auth.user_agent,
            event_count=len(batch.events),
        )
        stmt = stmt.on_duplicate_key_update(
            ts_server=stmt.inserted.ts_server,
            user_id=stmt.inserted.user_id,
            username=stmt.inserted.username,
            is_admin=stmt.inserted.is_admin,
            route=stmt.inserted.route,
            user_agent=stmt.inserted.user_agent,
            event_count=SessionRow.event_count + stmt.inserted.event_count,
        )
        await session.execute(stmt)

    await session.commit()


def _common_kwargs(
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


def _client_time(value: int | None) -> datetime | None:
    if value is None:
        return None
    try:
        # Strip tzinfo to match MySQL DATETIME column semantics.
        return datetime.fromtimestamp(value / 1000, UTC).replace(tzinfo=None)
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


def _sample(rate: float) -> bool:
    return rate >= 1 or random.random() <= max(rate, 0)


def _float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _fingerprint(name: str, message: str, stack: str) -> str:
    frames = "\n".join(stack.splitlines()[:3])
    normalized = re.sub(r"\d+", "<n>", message)
    return hashlib.sha256(f"{name}\n{normalized}\n{frames}".encode()).hexdigest()[:32]
