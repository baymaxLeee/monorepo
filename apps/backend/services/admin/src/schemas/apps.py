"""App registry API schemas."""

from pydantic import BaseModel, Field


class App(BaseModel):
    id: str
    title: str
    base_path: str
    remote_name: str
    expose_key: str
    entry: str
    requires_admin: bool
    is_enabled: bool
    sort_order: int
    created_at: str
    updated_at: str


class CreateAppInput(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=120)
    base_path: str = Field(min_length=1, max_length=200)
    remote_name: str = Field(min_length=1, max_length=120)
    expose_key: str = Field(default="./App", min_length=1, max_length=120)
    entry: str = Field(default="", max_length=500)
    requires_admin: bool = True
    is_enabled: bool = True
    sort_order: int = Field(default=0, ge=0)


class UpdateAppInput(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    base_path: str | None = Field(default=None, min_length=1, max_length=200)
    remote_name: str | None = Field(default=None, min_length=1, max_length=120)
    expose_key: str | None = Field(default=None, min_length=1, max_length=120)
    entry: str | None = Field(default=None, max_length=500)
    requires_admin: bool | None = None
    is_enabled: bool | None = None
    sort_order: int | None = Field(default=None, ge=0)
