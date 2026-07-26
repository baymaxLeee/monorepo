"""Temporary document resource URL schemas."""

from datetime import datetime

from pydantic import BaseModel, Field


class DocumentResourceURL(BaseModel):
    url: str
    expires_at: datetime
    mime_type: str
    filename: str


class FileResourceURLInput(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=32)
    path: str = Field(min_length=1, max_length=512)
