"""Error query service."""

from clickhouse_connect.driver import Client

from telemetry.crud.errors import list_errors
from telemetry.deps import AuthContext
from telemetry.schemas.error import ErrorEvent, ErrorListResponse


def get_errors(client: Client, current_user: AuthContext, limit: int) -> ErrorListResponse:
    return ErrorListResponse(items=[ErrorEvent(**item) for item in list_errors(client, current_user, limit)])
