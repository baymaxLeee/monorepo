"""Bot HTTP router."""

from deps import AdminUser, CurrentUser, DbSession, RedisClient
from fastapi import APIRouter
from schemas.bot import Bot, CreateBotInput, UpdateBotInput
from schemas.skill import AttachSkillInput, SkillSummary
from services.bots import BotService

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
    current_user: AdminUser,
    session: DbSession,
    redis: RedisClient,
) -> Bot:
    return await BotService(session, current_user, redis).create(payload.name)


@router.patch("/{bot_id}", response_model=Bot)
async def update_bot(
    bot_id: str,
    payload: UpdateBotInput,
    current_user: AdminUser,
    session: DbSession,
) -> Bot:
    return await BotService(session, current_user).update(bot_id, payload)


@router.delete("/{bot_id}", status_code=204)
async def delete_bot(
    bot_id: str,
    current_user: AdminUser,
    session: DbSession,
) -> None:
    await BotService(session, current_user).delete(bot_id)


@router.get("/{bot_id}/skills", response_model=list[SkillSummary])
async def list_bot_skills(
    bot_id: str,
    current_user: CurrentUser,
    session: DbSession,
) -> list[SkillSummary]:
    return await BotService(session, current_user).list_skills(bot_id)


@router.post("/{bot_id}/skills", response_model=list[SkillSummary])
async def attach_bot_skill(
    bot_id: str,
    payload: AttachSkillInput,
    current_user: AdminUser,
    session: DbSession,
) -> list[SkillSummary]:
    return await BotService(session, current_user).attach_skill(bot_id, payload.skill_id)


@router.delete("/{bot_id}/skills/{skill_id}", response_model=list[SkillSummary])
async def detach_bot_skill(
    bot_id: str,
    skill_id: str,
    current_user: AdminUser,
    session: DbSession,
) -> list[SkillSummary]:
    return await BotService(session, current_user).detach_skill(bot_id, skill_id)
