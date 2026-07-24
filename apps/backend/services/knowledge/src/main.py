"""FastAPI app entry."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from api.http.routes import (
    conversation_cleanup_internal,
    documents,
    documents_internal,
    files_internal,
    health,
    ingest,
    resources,
    retrieval_internal,
)
from application.admin_client import close_admin_client
from application.indexer import sweep_claim
from application.processor import sweep_process
from bootstrap.config import get_settings
from fastapi import FastAPI
from infrastructure.persistence.database import close_db
from kernel.errors import register_exception_handlers
from kernel.logging import RequestLoggingMiddleware, configure_logging
from kernel.observability import configure_opentelemetry
from kernel.tracing import TraceIDMiddleware

logger = logging.getLogger("knowledge.main")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Convert sweep first: a doc must reach ``ready`` (content_md written) before
    # the indexer can chunk it, so recover pending converts ahead of indexing.
    try:
        reconverted = await sweep_process()
        if reconverted:
            logger.info("re-queued %d document(s) for background conversion", reconverted)
    except Exception:  # startup recovery is best-effort; never block boot
        logger.exception("convert sweep on startup failed")
    try:
        recovered = await sweep_claim()
        if recovered:
            logger.info("re-queued %d document(s) for background indexing", recovered)
    except Exception:  # startup recovery is best-effort; never block boot
        logger.exception("index sweep on startup failed")
    yield
    await close_admin_client()
    await close_db()


def create_app() -> FastAPI:
    configure_logging("knowledge")
    configure_opentelemetry("knowledge")
    settings = get_settings()
    app = FastAPI(
        title="Knowledge Service",
        version="0.1.0",
        description="Knowledge base: ingest, storage, MarkItDown conversion, artifacts",
        lifespan=lifespan,
        # Swagger/OpenAPI HTTP routes are docs UI only — `gen-openapi` calls
        # app.openapi() in-process, so hiding these in prod doesn't affect
        # codegen. Internal routers document real artifact/document internals,
        # so the interactive UI must not be reachable off the cluster network.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    register_exception_handlers(app)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(TraceIDMiddleware)
    app.include_router(health.router)
    app.include_router(ingest.router)
    app.include_router(documents.router)
    app.include_router(documents_internal.router)
    app.include_router(resources.router)
    app.include_router(files_internal.router)
    app.include_router(conversation_cleanup_internal.router)
    app.include_router(retrieval_internal.router)
    return app


app = create_app()
