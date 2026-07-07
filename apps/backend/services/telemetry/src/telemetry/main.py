"""FastAPI app entry."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from kernel.errors import register_exception_handlers
from kernel.logging import RequestLoggingMiddleware, configure_logging
from kernel.observability import configure_opentelemetry
from kernel.tracing import TraceIDMiddleware

from .db import close_db
from .routers import errors, health, ops, performance, rum


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    yield
    await close_db()


def create_app() -> FastAPI:
    configure_logging("telemetry")
    configure_opentelemetry("telemetry")
    app = FastAPI(
        title="Telemetry Service",
        version="0.1.0",
        description="自托管前端 RUM 采集与查询服务(PostgreSQL 后端)",
        lifespan=lifespan,
    )
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(TraceIDMiddleware)
    register_exception_handlers(app)
    app.include_router(health.router)
    app.include_router(rum.router)
    app.include_router(errors.router)
    app.include_router(performance.router)
    app.include_router(ops.router)
    return app


app = create_app()
