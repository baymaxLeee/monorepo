"""FastAPI app entry."""

import asyncio
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
from application.asset_client import close_asset_client, run_asset_claim_relay
from application.executor_client import close_executor_client, run_document_dispatcher
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
    stop = asyncio.Event()
    dispatcher = asyncio.create_task(run_document_dispatcher(stop), name="document-task-dispatcher")
    claim_relay = asyncio.create_task(run_asset_claim_relay(stop), name="asset-claim-relay")
    yield
    stop.set()
    await dispatcher
    await claim_relay
    await close_asset_client()
    await close_executor_client()
    await close_admin_client()
    await close_db()


def create_app() -> FastAPI:
    configure_logging("knowledge")
    configure_opentelemetry("knowledge")
    settings = get_settings()
    app = FastAPI(
        title="Knowledge Service",
        version="0.1.0",
        description="Knowledge base: parsing, virtual agent workspaces, and RAG",
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
