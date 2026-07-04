"""Apply service-owned PostgreSQL migrations for deployment jobs."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

import asyncpg  # type: ignore[import-untyped]

from knowledge.config import get_settings

_VERSION_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
_DATABASE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_VERSIONS_DIR = Path(__file__).resolve().parents[2] / "migrations" / "versions"


def _version_key(version: str) -> tuple[int, int, int]:
    match = _VERSION_RE.fullmatch(version)
    if match is None:
        raise ValueError(f"invalid migration version: {version}")
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


async def _connect(database: str) -> asyncpg.Connection:
    settings = get_settings()
    return await asyncpg.connect(
        host=settings.postgres_host,
        port=settings.postgres_port,
        user=settings.postgres_user,
        password=settings.postgres_password,
        database=database,
    )


async def _ensure_database(database: str) -> None:
    if _DATABASE_RE.fullmatch(database) is None:
        raise ValueError(f"invalid PostgreSQL database name: {database}")

    connection = await _connect("postgres")
    try:
        exists = await connection.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", database)
        if exists is None:
            await connection.execute(f'CREATE DATABASE "{database}"')
            print(f"created PostgreSQL database: {database}")
    finally:
        await connection.close()


async def migrate() -> None:
    settings = get_settings()
    database = settings.postgres_database
    await _ensure_database(database)

    migrations = sorted(
        ((_version_key(path.stem), path.stem, path) for path in _VERSIONS_DIR.glob("v*.sql")),
        key=lambda item: item[0],
    )
    if not migrations:
        raise RuntimeError(f"no migrations found in {_VERSIONS_DIR}")

    connection = await _connect(database)
    try:
        await connection.execute("CREATE EXTENSION IF NOT EXISTS vector")
        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS migration (
              id smallint NOT NULL PRIMARY KEY,
              version varchar(32) NOT NULL,
              update_time timestamptz NOT NULL
            );
            INSERT INTO migration (id, version, update_time)
            VALUES (1, 'v0.0.0', NOW())
            ON CONFLICT (id) DO NOTHING;
            """
        )

        current = await connection.fetchval("SELECT version FROM migration WHERE id = 1")
        current_key = _version_key(str(current))
        latest_key, latest_version, _ = migrations[-1]
        if current_key > latest_key:
            raise RuntimeError(f"database migration version {current} is newer than local {latest_version}")

        for version_key, version, path in migrations:
            if version_key <= current_key:
                continue
            print(f"applying knowledge migration: {path.name}")
            async with connection.transaction():
                await connection.execute(path.read_text(encoding="utf-8"))
                await connection.execute(
                    "UPDATE migration SET version = $1, update_time = NOW() WHERE id = 1",
                    version,
                )
            current_key = version_key

        final_version = await connection.fetchval("SELECT version FROM migration WHERE id = 1")
        print(f"knowledge migration.version = {final_version}")
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(migrate())
