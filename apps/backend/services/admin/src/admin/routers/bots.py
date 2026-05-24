"""Bot HTTP router."""

from fastapi import APIRouter

from admin.deps import CurrentUser, DbSession, RedisClient
from admin.schemas.bot import Bot, CreateBotInput
from admin.services.bots import BotService

router = APIRouter(prefix="/bot", tags=["bot"])


@router.get("", response_model=list[Bot])
async def list_bots(current_user: CurrentUser, session: DbSession) -> list[Bot]:
    return await BotService(session, current_user).list()


@router.get("/{bot_id}", response_model=Bot)
async def get_bot(bot_id: str, current_user: CurrentUser, session: DbSession) -> Bot:
    return await BotService(session, current_user).get(bot_id)


@router.post("", response_model=Bot, status_code=201)
async def create_bot(
    payload: CreateBotInput,
    current_user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
) -> Bot:
    return await BotService(session, current_user, redis).create(payload.name)
