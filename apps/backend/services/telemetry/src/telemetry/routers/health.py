"""Health endpoints.

We split liveness from readiness so K8s only restarts on real process
failures, not on transient downstream blips.
"""

from fastapi import APIRouter, Response, status

from telemetry.deps import ClickHouse

router = APIRouter(tags=["health"])


@router.get("/livez")
async def livez() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(client: ClickHouse, response: Response) -> dict[str, object]:
    try:
        client.query("SELECT 1")
        clickhouse_ok = True
    except Exception:
        clickhouse_ok = False

    response.status_code = (
        status.HTTP_200_OK if clickhouse_ok else status.HTTP_503_SERVICE_UNAVAILABLE
    )
    return {
        "status": "ok" if clickhouse_ok else "degraded",
        "clickhouse": "up" if clickhouse_ok else "down",
    }


@router.get("/healthz")
async def healthz(client: ClickHouse, response: Response) -> dict[str, object]:
    return await readyz(client, response)
