"""OpenAPI conventions shared by FastAPI services."""

from fastapi.routing import APIRoute


def operation_id_from_route_name(route: APIRoute) -> str:
    """Use the endpoint function name as the stable generated-client operation id."""
    return route.name
