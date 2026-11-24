"""FastAPI app entry."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from api.http.routes import (
    documents,
    health,
    ingest,
)
from api.mcp.server import mcp as knowledge_mcp
from api.mcp.server import mcp_app as knowledge_mcp_app
from application.admin_client import close_admin_client
from application.storage_client import close_storage_client, run_asset_claim_relay
from bootstrap.config import get_settings
from fastapi import FastAPI
from infrastructure.persistence.database import close_db
from knowledge_kernel.errors import register_exception_handlers
from knowledge_kernel.logging import RequestLoggingMiddleware, configure_logging
from knowledge_kernel.observability import configure_opentelemetry
from knowledge_kernel.openapi import operation_id_from_route_name
from knowledge_kernel.tracing import TraceIDMiddleware

logger = logging.getLogger("knowledge.main")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    async with knowledge_mcp.session_manager.run():
        stop = asyncio.Event()
        claim_relay = asyncio.create_task(run_asset_claim_relay(stop), name="asset-claim-relay")
        try:
            yield
        finally:
            stop.set()
            await claim_relay
            await close_storage_client()
            await close_admin_client()
            await close_db()


def create_app() -> FastAPI:
    configure_logging("knowledge")
    configure_opentelemetry("knowledge")
    settings = get_settings()
    app = FastAPI(
        title="Knowledge Service",
        version="0.1.0",
        description="Knowledge base: document parsing, indexing, and RAG",
        lifespan=lifespan,
        generate_unique_id_function=operation_id_from_route_name,
        # Swagger/OpenAPI HTTP routes are docs UI only — `gen-openapi` calls
        # app.openapi() in-process, so hiding these in prod doesn't affect codegen.
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
    # Keep product routes before the catch-all mount. The host lifespan owns the
    # mounted MCP session manager per the official Python SDK contract.
    app.mount("/", knowledge_mcp_app)
    return app


app = create_app()
