"""FastAPI app entry."""

from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from kernel.errors import register_exception_handlers

from .db import close_db, init_db, seed_demo_bots
from .redis_client import close_redis, init_redis
from .routers import bots, health

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
    # CORS、鉴权等横切关注点由 api-gateway 统一处理。
    # 内网微服务只面向 gateway,不直接面向浏览器。
    app = FastAPI(
        title="Admin Service",
        version="0.1.0",
        description="智能体管理微服务",
        lifespan=lifespan,
    )

    register_exception_handlers(app)
    app.include_router(health.router)
    app.include_router(bots.router)
    return app


app = create_app()
