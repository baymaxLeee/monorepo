"""FastAPI app entry."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from kernel.errors import register_exception_handlers
from kernel.tracing import TraceIDMiddleware

from .config import get_settings
from .db import close_db, seed_demo_bots
from .redis_client import close_redis, init_redis
from .routers import bots, health, intentions, scenes


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_redis()
    # Demo data is only useful for development/staging. In production,
    # seed data must be loaded through explicit migrations / admin tooling.
    if not get_settings().is_production:
        await seed_demo_bots()
    yield
    await close_redis()
    await close_db()


def create_app() -> FastAPI:
    # CORS、鉴权等横切关注点由 gateway 统一处理。
    # 内网微服务只面向 gateway,不直接面向浏览器。
    app = FastAPI(
        title="Admin Service",
        version="0.1.0",
        description="智能体管理微服务",
        lifespan=lifespan,
    )

    register_exception_handlers(app)
    app.add_middleware(TraceIDMiddleware)
    app.include_router(health.router)
    app.include_router(bots.router)
    app.include_router(scenes.router)
    app.include_router(intentions.router)
    return app


app = create_app()
