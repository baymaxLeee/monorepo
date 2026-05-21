"""FastAPI dependencies."""

from collections.abc import AsyncGenerator

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db_session
from .redis_client import get_redis


async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_session():
        yield session


def redis_client() -> Redis:
    return get_redis()
