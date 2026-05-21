"""Use admin_test database; TestClient lifespan wires up Postgres + Redis."""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient

_ENV_DIR = Path(__file__).resolve().parents[1]
load_dotenv(_ENV_DIR / ".env")

os.environ["DATABASE_URL"] = "postgresql+asyncpg://dev:dev@localhost:5432/admin_test"
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    from admin.main import app

    with TestClient(app) as test_client:
        yield test_client
