"""Bot CRUD routes (demo).

In a real service these would talk to a SQLAlchemy session via a repository.
For the demo we use an in-memory store so the app runs without a DB.
"""

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel, Field

from kernel.errors import NotFoundError

router = APIRouter(prefix="/bots", tags=["bots"])


class Bot(BaseModel):
    id: str
    name: str
    status: Literal["draft", "published", "archived"]
    created_at: str


class CreateBotInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)


_STORE: dict[str, Bot] = {
    "demo-1": Bot(
        id="demo-1",
        name="客服助手",
        status="published",
        created_at="2026-01-15T08:30:00Z",
    ),
    "demo-2": Bot(
        id="demo-2",
        name="销售小助理",
        status="draft",
        created_at="2026-02-20T11:15:00Z",
    ),
    "demo-3": Bot(
        id="demo-3",
        name="代码评审员",
        status="published",
        created_at="2026-03-10T16:42:00Z",
    ),
}


@router.get("", response_model=list[Bot])
async def list_bots() -> list[Bot]:
    return list(_STORE.values())


@router.get("/{bot_id}", response_model=Bot)
async def get_bot(bot_id: str) -> Bot:
    if bot_id not in _STORE:
        raise NotFoundError(f"bot {bot_id} not found")
    return _STORE[bot_id]


@router.post("", response_model=Bot, status_code=201)
async def create_bot(payload: CreateBotInput) -> Bot:
    new_id = uuid4().hex[:8]
    bot = Bot(
        id=new_id,
        name=payload.name,
        status="draft",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    _STORE[new_id] = bot
    return bot
