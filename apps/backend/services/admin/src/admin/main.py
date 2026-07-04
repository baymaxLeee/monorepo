"""FastAPI app entry."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from kernel.errors import register_exception_handlers
from kernel.tracing import TraceIDMiddleware

from .config import get_settings
from .db import close_db, seed_demo_bots
from .redis_client import close_redis, init_redis
from .routers import (
    agents_internal,
    apps,
    bots,
    health,
    intentions,
    providers,
    providers_internal,
    scenes,
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_redis()
    if not get_settings().is_production:
        await seed_demo_bots()
    yield
    await close_redis()
    await close_db()


def create_app() -> FastAPI:
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
    app.include_router(providers.router)
    app.include_router(providers_internal.router)
    app.include_router(agents_internal.router)
    app.include_router(apps.router)
    return app


app = create_app()
