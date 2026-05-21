"""Bot CRUD routes (Postgres + Redis)."""

from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from admin.deps import db_session, redis_client
from admin.models.bot import BotRow
from kernel.errors import NotFoundError

router = APIRouter(prefix="/bots", tags=["bots"])


class Bot(BaseModel):
    id: str
    name: str
    status: Literal["draft", "published", "archived"]
    created_at: str


class CreateBotInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)


def _to_schema(row: BotRow) -> Bot:
    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return Bot(
        id=row.id,
        name=row.name,
        status=row.status,  # type: ignore[arg-type]
        created_at=created.isoformat().replace("+00:00", "Z"),
    )


@router.get("", response_model=list[Bot])
async def list_bots(session: AsyncSession = Depends(db_session)) -> list[Bot]:
    result = await session.scalars(select(BotRow).order_by(BotRow.created_at))
    return [_to_schema(row) for row in result.all()]


@router.get("/{bot_id}", response_model=Bot)
async def get_bot(
    bot_id: str,
    session: AsyncSession = Depends(db_session),
) -> Bot:
    row = await session.get(BotRow, bot_id)
    if row is None:
        raise NotFoundError(f"bot {bot_id} not found")
    return _to_schema(row)


@router.post("", response_model=Bot, status_code=201)
async def create_bot(
    payload: CreateBotInput,
    session: AsyncSession = Depends(db_session),
    redis: Redis = Depends(redis_client),
) -> Bot:
    new_id = uuid4().hex[:8]
    row = BotRow(
        id=new_id,
        name=payload.name,
        status="draft",
        created_at=datetime.now(UTC),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    await redis.incr("admin:bots:created")
    return _to_schema(row)
