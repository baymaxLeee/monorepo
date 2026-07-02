"""Document chunk ORM model for RAG retrieval (Postgres + pgvector).

One row per retrievable chunk of a document. `embedding` is the dense vector
(pgvector); the sparse BM25 side is a DB-maintained `tsv tsvector` GENERATED
column (see the migration) that the ORM never writes, so it is not mapped here.
"""

from datetime import datetime

from knowledge.config import get_settings
from pgvector.sqlalchemy import Vector  # type: ignore[import-untyped]
from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class DocumentChunkRow(Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="ux_document_chunks_doc_index"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(String(26), index=True, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # Raw chunk text (what gets returned to the model / shown as a citation).
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Chunk text with the prepended contextual summary (what gets embedded /
    # indexed). Null when contextual retrieval is disabled.
    contextualized_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(get_settings().embedding_dim), nullable=True
    )
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embed_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
