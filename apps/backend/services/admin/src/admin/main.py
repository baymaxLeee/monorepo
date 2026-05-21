"""FastAPI app entry."""

from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from kernel.errors import register_exception_handlers

from .db import close_db, init_db, seed_demo_bots
from .redis_client import close_redis, init_redis
from .routes import bots, health

load_dotenv()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    await init_redis()
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
