import httpx
import pytest
from fastapi import FastAPI

from kernel.errors import ForbiddenError, NotFoundError, register_exception_handlers


@pytest.mark.parametrize(
    ("error_type", "status", "code"), [(ForbiddenError, 403, "forbidden"), (NotFoundError, 404, "not_found")]
)
async def test_domain_errors_preserve_public_http_contract(
    error_type: type[ForbiddenError] | type[NotFoundError], status: int, code: str
) -> None:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/resource")
    async def resource() -> None:
        raise error_type("Unavailable", details={"resource": "document"})

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/resource")
    assert response.status_code == status
    assert response.json() == {"code": code, "message": "Unavailable", "details": {"resource": "document"}}
