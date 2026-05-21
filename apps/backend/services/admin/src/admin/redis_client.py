"""Redis connection for cache / ephemeral state."""

from redis.asyncio import Redis

from .config import get_settings

_redis: Redis | None = None


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis


async def init_redis() -> None:
    client = get_redis()
    await client.ping()
    await client.set("admin:boot", "ok")


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
    _redis = None


async def ping_redis() -> bool:
    try:
        return bool(await get_redis().ping())
    except Exception:
        return False
