"""FastAPI app entry."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from kernel.errors import register_exception_handlers
from kernel.tracing import TraceIDMiddleware

from .db import close_client
from .routers import errors, health, rum

load_dotenv()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    yield
    close_client()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Telemetry Service",
        version="0.1.0",
        description="自托管前端 RUM 采集与查询服务",
        lifespan=lifespan,
    )
    app.add_middleware(TraceIDMiddleware)
    register_exception_handlers(app)
    app.include_router(health.router)
    app.include_router(rum.router)
    app.include_router(errors.router)
    return app


app = create_app()
