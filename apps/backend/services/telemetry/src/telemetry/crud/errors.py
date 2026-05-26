"""MySQL reads for error events."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from telemetry.deps import AuthContext
from telemetry.models import EventErrorRow


async def list_errors(
    session: AsyncSession,
    current_user: AuthContext,
    limit: int = 100,
) -> list[dict[str, Any]]:
    stmt = select(EventErrorRow).order_by(EventErrorRow.ts_server.desc()).limit(min(limit, 500))
    if not current_user.is_admin:
        stmt = stmt.where(EventErrorRow.user_id == current_user.user_id)

    result = await session.execute(stmt)
    items: list[dict[str, Any]] = []
    for row in result.scalars():
        items.append(
            {
                "ts_server": row.ts_server,
                "app": row.app,
                "release": row.release,
                "user_id": row.user_id,
                "username": row.username,
                "is_admin": bool(row.is_admin),
                "device_id": row.device_id,
                "session_id": row.session_id,
                "trace_id": row.trace_id,
                "route": row.route,
                "fingerprint": row.fingerprint,
                "name": row.name,
                "message": row.message or "",
                "stack": row.stack or "",
                "payload": row.payload if isinstance(row.payload, dict) else {},
            }
        )
    return items
