"""Use admin_test database; TestClient lifespan wires up MySQL + Redis."""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient

_ENV_DIR = Path(__file__).resolve().parents[1]
load_dotenv(_ENV_DIR / ".env")

os.environ["MYSQL_DATABASE"] = "admin_test"
os.environ.setdefault("REDIS_HOST", "localhost")
os.environ.setdefault("REDIS_PORT", "6379")
os.environ.setdefault("REDIS_DB", "0")

from admin.config import get_settings

get_settings.cache_clear()


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    from admin.main import app

    with TestClient(app) as test_client:
        yield test_client
