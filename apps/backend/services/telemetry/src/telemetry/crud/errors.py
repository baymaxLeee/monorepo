"""ClickHouse reads for error events."""

import json
from typing import Any

from clickhouse_connect.driver import Client

from telemetry.deps import AuthContext


def list_errors(client: Client, current_user: AuthContext, limit: int = 100) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"limit": min(limit, 500)}
    where = ""
    if not current_user.is_admin:
        where = "WHERE user_id = {user_id:String}"
        params["user_id"] = current_user.user_id

    result = client.query(
        f"""
        SELECT
            ts_server,
            app,
            release,
            user_id,
            username,
            is_admin,
            device_id,
            session_id,
            trace_id,
            route,
            fingerprint,
            name,
            message,
            stack,
            payload
        FROM events_error
        {where}
        ORDER BY ts_server DESC
        LIMIT {{limit:UInt32}}
        """,
        parameters=params,
    )
    items: list[dict[str, Any]] = []
    for row in result.named_results():
        row["is_admin"] = bool(row["is_admin"])
        row["payload"] = _json_object(row["payload"])
        items.append(row)
    return items


def _json_object(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}
