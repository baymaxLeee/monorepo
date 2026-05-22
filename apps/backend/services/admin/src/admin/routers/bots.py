"""Bot HTTP router."""

from fastapi import APIRouter

from admin.deps import AuthUserID, DbSession, RedisClient
from admin.schemas.bot import Bot, CreateBotInput
from admin.services.bots import BotService

router = APIRouter(prefix="/bots", tags=["bots"])


@router.get("", response_model=list[Bot])
async def list_bots(user_id: AuthUserID, session: DbSession) -> list[Bot]:
    return await BotService(session, user_id).list()


@router.get("/{bot_id}", response_model=Bot)
async def get_bot(bot_id: str, user_id: AuthUserID, session: DbSession) -> Bot:
    return await BotService(session, user_id).get(bot_id)


@router.post("", response_model=Bot, status_code=201)
async def create_bot(
    payload: CreateBotInput,
    user_id: AuthUserID,
    session: DbSession,
    redis: RedisClient,
) -> Bot:
    return await BotService(session, user_id, redis).create(payload.name)
