"""Retrieval (RAG) API schemas."""

from pydantic import BaseModel, Field


class RetrieveInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=26)
    org_id: str = Field(min_length=1, max_length=26)
    query: str = Field(min_length=1, max_length=4000)
    top_k: int | None = Field(default=None, ge=1, le=50)


class RetrievedChunk(BaseModel):
    document_id: str
    chunk_index: int
    content: str
    score: float
    title: str
    filename: str


class RetrieveResult(BaseModel):
    query: str
    chunks: list[RetrievedChunk]
    note: str | None = None
