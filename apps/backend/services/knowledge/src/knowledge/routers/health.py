"""Health endpoints."""

from fastapi import APIRouter, Response, status
from knowledge.db import get_engine
from sqlalchemy import text

router = APIRouter(tags=["meta"])


@router.get("/livez")
async def livez() -> dict[str, str]:
    return {"status": "ok"}


async def _readiness(response: Response) -> dict[str, str]:
    try:
        async with get_engine().connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "postgres": "down"}
    return {"status": "ok", "postgres": "up"}


@router.get("/readyz")
async def readyz(response: Response) -> dict[str, str]:
    return await _readiness(response)


@router.get("/healthz")
async def healthz(response: Response) -> dict[str, str]:
    return await _readiness(response)
