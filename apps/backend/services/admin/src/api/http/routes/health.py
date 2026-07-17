from fastapi import APIRouter, Response, status
from infrastructure.cache.redis import ping_redis
from infrastructure.persistence.database import get_engine
from sqlalchemy import text

router = APIRouter(tags=["meta"])


@router.get("/livez")
async def livez() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(response: Response) -> dict[str, object]:
    redis_ok = await ping_redis()
    db_ok = False
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    healthy = db_ok and redis_ok
    response.status_code = status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ok" if healthy else "degraded",
        "postgres": "up" if db_ok else "down",
        "redis": "up" if redis_ok else "down",
    }


@router.get("/healthz")
async def healthz(response: Response) -> dict[str, object]:
    return await readyz(response)
