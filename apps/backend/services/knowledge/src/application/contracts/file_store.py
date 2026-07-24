from typing import Literal

from pydantic import BaseModel, Field


class FileEntry(BaseModel):
    path: str
    type: Literal["file"] = "file"
    mime_type: str
    size: int
    sha256: str
    writable: bool
    derived: bool


class FileRead(FileEntry):
    offset: int
    total_lines: int
    next_offset: int | None
    content: str


class CreateChangeSetInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    org_id: str = Field(min_length=1, max_length=26)
    conversation_id: str = Field(min_length=1, max_length=32)
    metadata: dict[str, str] | None = None


class ChangeSet(BaseModel):
    id: str
    status: str
    conversation_id: str


class WriteChangeSetFileInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    path: str = Field(min_length=1, max_length=512)
    content: str = Field(max_length=500_000)
    mime_type: str = Field(min_length=1, max_length=120)
    writable: bool = True
    derived: bool = False


class PromoteChangeSetInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)


class FileSearchInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    conversation_id: str = Field(min_length=1, max_length=32)
    pattern: str = Field(min_length=1, max_length=500)
    path: str | None = Field(default=None, max_length=512)
    glob: str | None = Field(default=None, max_length=120)


class FileSearchMatch(BaseModel):
    path: str
    line: int
    column: int
    text: str
