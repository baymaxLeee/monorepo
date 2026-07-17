"""Temporary document resource URL schemas."""

from datetime import datetime

from pydantic import BaseModel


class DocumentResourceURL(BaseModel):
    url: str
    expires_at: datetime
    mime_type: str
    filename: str
