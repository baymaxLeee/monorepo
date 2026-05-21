"""FastAPI app entry."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from kernel.errors import register_exception_handlers

from .routes import bots, health


def create_app() -> FastAPI:
    app = FastAPI(
        title="Bot Service",
        version="0.1.0",
        description="智能体管理微服务",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://localhost:3001"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)
    app.include_router(health.router)
    app.include_router(bots.router, prefix="/v1")
    return app


app = create_app()
