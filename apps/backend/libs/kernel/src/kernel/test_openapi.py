from fastapi import APIRouter
from fastapi.routing import APIRoute

from kernel.openapi import operation_id_from_route_name


def test_operation_id_uses_route_name() -> None:
    router = APIRouter()

    @router.get("/items")
    async def list_items() -> None:
        return None

    route = next(route for route in router.routes if isinstance(route, APIRoute))
    assert operation_id_from_route_name(route) == "list_items"
