"""Bot API schemas."""

from typing import Literal

from pydantic import BaseModel, Field


class Bot(BaseModel):
    id: str
    user_id: str
    name: str
    status: Literal["draft", "published", "archived"]
    created_at: str


class CreateBotInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
