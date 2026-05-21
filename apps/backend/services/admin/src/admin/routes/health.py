from fastapi import APIRouter
from sqlalchemy import text

from admin.db import get_engine
from admin.redis_client import ping_redis

router = APIRouter(tags=["meta"])


@router.get("/healthz")
async def healthz() -> dict[str, object]:
    postgres_ok = False
    redis_ok = await ping_redis()
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        postgres_ok = True
    except Exception:
        postgres_ok = False

    status = "ok" if postgres_ok and redis_ok else "degraded"
    return {
        "status": status,
        "postgres": "up" if postgres_ok else "down",
        "redis": "up" if redis_ok else "down",
    }
