"""Health endpoints."""

from fastapi import APIRouter

from telemetry.deps import ClickHouse

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz(client: ClickHouse) -> dict[str, object]:
    client.query("SELECT 1")
    return {"status": "ok", "clickhouse": "ok"}
