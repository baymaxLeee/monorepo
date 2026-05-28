"""Redis connection for cache / ephemeral state."""

from inspect import isawaitable
from typing import Any

from redis.asyncio import Redis

from .config import get_settings

_redis: Redis | None = None


async def _bool_result(value: Any) -> bool:
    if isawaitable(value):
        value = await value
    return bool(value)


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis


async def init_redis() -> None:
    client = get_redis()
    await _bool_result(client.ping())
    await _bool_result(client.set("chat:boot", "ok"))


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
    _redis = None


async def ping_redis() -> bool:
    try:
        return await _bool_result(get_redis().ping())
    except Exception:
        return False
