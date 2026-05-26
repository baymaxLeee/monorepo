"""Health endpoints.

We split liveness from readiness so K8s only restarts on real process
failures, not on transient downstream blips.
"""

from fastapi import APIRouter, Response, status
from sqlalchemy import text

from telemetry.deps import DbSession

router = APIRouter(tags=["health"])


@router.get("/livez")
async def livez() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(session: DbSession, response: Response) -> dict[str, object]:
    try:
        await session.execute(text("SELECT 1"))
        mysql_ok = True
    except Exception:
        mysql_ok = False

    response.status_code = status.HTTP_200_OK if mysql_ok else status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ok" if mysql_ok else "degraded",
        "mysql": "up" if mysql_ok else "down",
    }


@router.get("/healthz")
async def healthz(session: DbSession, response: Response) -> dict[str, object]:
    return await readyz(session, response)
