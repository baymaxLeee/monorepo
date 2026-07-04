from fastapi import APIRouter, Response, status
from sqlalchemy import text

from admin.db import get_engine
from admin.redis_client import ping_redis

router = APIRouter(tags=["meta"])


@router.get("/livez")
async def livez() -> dict[str, str]:
    return {"status": "ok"}


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


@router.get("/healthz")
async def healthz(response: Response) -> dict[str, object]:
    return await readyz(response)
