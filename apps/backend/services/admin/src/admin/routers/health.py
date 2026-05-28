from fastapi import APIRouter, Response, status
from sqlalchemy import text

from admin.db import get_engine
from admin.redis_client import ping_redis

router = APIRouter(tags=["meta"])


# Liveness: only confirms the process is up. K8s uses this to decide whether
# to RESTART the container — must NOT fail on dependency hiccups, or a
# transient DB blip will trigger a kill loop.
@router.get("/livez")
async def livez() -> dict[str, str]:
    return {"status": "ok"}


# Readiness: confirms downstream deps are reachable. K8s uses this to decide
# whether to ROUTE traffic. Returning 503 here removes the pod from the
# Service endpoints without killing it.
@router.get("/readyz")
async def readyz(response: Response) -> dict[str, object]:
    redis_ok = await ping_redis()
    mysql_ok = False
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        mysql_ok = True
    except Exception:
        mysql_ok = False

    healthy = mysql_ok and redis_ok
    response.status_code = status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ok" if healthy else "degraded",
        "mysql": "up" if mysql_ok else "down",
        "redis": "up" if redis_ok else "down",
    }


# Back-compat alias; existing scripts and dev tooling hit /healthz.
@router.get("/healthz")
async def healthz(response: Response) -> dict[str, object]:
    return await readyz(response)
