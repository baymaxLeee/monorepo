"""Bot HTTP router."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from admin.deps import db_session, redis_client
from admin.schemas.bot import Bot, CreateBotInput
from admin.services.bots import BotService

router = APIRouter(prefix="/bots", tags=["bots"])
DemoUserID = Annotated[str | None, Header(alias="X-Auth-User-ID")]


@router.get("", response_model=list[Bot])
async def list_bots(
    session: AsyncSession = Depends(db_session),
    user_id: DemoUserID = None,
) -> list[Bot]:
    return await BotService(session, user_id or "demo-super-admin").list()


@router.get("/{bot_id}", response_model=Bot)
async def get_bot(
    bot_id: str,
    session: AsyncSession = Depends(db_session),
    user_id: DemoUserID = None,
) -> Bot:
    return await BotService(session, user_id or "demo-super-admin").get(bot_id)


@router.post("", response_model=Bot, status_code=201)
async def create_bot(
    payload: CreateBotInput,
    session: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
    user_id: DemoUserID = None,
) -> Bot:
    return await BotService(session, user_id or "demo-super-admin", redis).create(payload.name)
