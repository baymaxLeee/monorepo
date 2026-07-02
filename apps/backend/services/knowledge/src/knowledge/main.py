"""FastAPI app entry."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from kernel.errors import register_exception_handlers
from kernel.tracing import TraceIDMiddleware

from knowledge.db import close_db
from knowledge.routers import (
    artifacts_internal,
    documents,
    documents_internal,
    health,
    ingest,
    retrieval_internal,
)
from knowledge.services.admin_client import close_admin_client


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield
    await close_admin_client()
    await close_db()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Knowledge Service",
        version="0.1.0",
        description="Knowledge base: ingest, storage, MarkItDown conversion, artifacts",
        lifespan=lifespan,
    )
    register_exception_handlers(app)
    app.add_middleware(TraceIDMiddleware)
    app.include_router(health.router)
    app.include_router(ingest.router)
    app.include_router(documents.router)
    app.include_router(documents_internal.router)
    app.include_router(artifacts_internal.router)
    app.include_router(retrieval_internal.router)
    return app


app = create_app()
