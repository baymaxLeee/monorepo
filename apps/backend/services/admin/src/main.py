"""FastAPI app entry."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from config import get_settings
from db import close_db, seed_demo_apps
from fastapi import FastAPI
from kernel.errors import register_exception_handlers
from kernel.logging import RequestLoggingMiddleware, configure_logging
from kernel.observability import configure_opentelemetry
from kernel.tracing import TraceIDMiddleware
from redis_client import close_redis, init_redis
from routers import (
    agents_internal,
    apps,
    bots,
    health,
    providers,
    providers_internal,
    skills,
    skills_internal,
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_redis()
    if not get_settings().is_production:
        await seed_demo_apps()
    yield
    await close_redis()
    await close_db()


def create_app() -> FastAPI:
    configure_logging("admin")
    configure_opentelemetry("admin")
    settings = get_settings()
    app = FastAPI(
        title="Admin Service",
        version="0.1.0",
        description="智能体管理微服务",
        lifespan=lifespan,
        # Swagger/OpenAPI HTTP routes are docs UI only — `gen-openapi` calls
        # app.openapi() in-process, so hiding these in prod doesn't affect
        # codegen. Internal routers still ship real secrets in examples/docs,
        # so the interactive UI must not be reachable off the cluster network.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    register_exception_handlers(app)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(TraceIDMiddleware)
    app.include_router(health.router)
    app.include_router(bots.router)
    app.include_router(skills.router)
    app.include_router(skills_internal.router)
    app.include_router(providers.router)
    app.include_router(providers_internal.router)
    app.include_router(agents_internal.router)
    app.include_router(apps.router)
    return app


app = create_app()
