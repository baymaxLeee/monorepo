"""Attachment conversion schemas."""

from pydantic import BaseModel, Field


class ConvertedAttachment(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(default="application/octet-stream", max_length=120)
    size: int = Field(ge=0)
    markdown: str
    markdown_chars: int = Field(ge=0)
    truncated: bool = False
