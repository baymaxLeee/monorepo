"""ClickHouse client lifecycle."""

from collections.abc import Generator

import clickhouse_connect
from clickhouse_connect.driver import Client

from .config import get_settings

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        settings = get_settings()
        _client = clickhouse_connect.get_client(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            username=settings.clickhouse_user,
            password=settings.clickhouse_password,
            database=settings.clickhouse_database,
        )
    return _client


def clickhouse_client() -> Generator[Client, None, None]:
    yield get_client()


def close_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
