"""RAG indexing orchestration: document -> chunks -> (context) -> embeddings.

Called after a document's `content_md` is ready (ingest) or changes (edit). It
fully replaces a document's chunks each time, so re-indexing on update and
FK ON DELETE CASCADE on delete keep the index fresh (时效性). Best-effort:
returns a note instead of raising when no embedding provider is configured, so
document upload/edit never fails because RAG is unconfigured.
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from datetime import UTC, datetime

import anyio
from knowledge.config import get_settings
from knowledge.crud import chunks as chunk_crud
from knowledge.crud import documents as document_crud
from knowledge.models.chunk import DocumentChunkRow
from knowledge.models.document import DocumentRow
from knowledge.services.admin_client import ProviderNotConfiguredError, ProviderSnapshot, get_admin_client
from knowledge.services.chunking import chunk_text, estimate_tokens
from knowledge.services.contextual import contextualize_chunks
from knowledge.services.embed_client import embed_image, embed_texts, is_multimodal_embedding_model
from knowledge.services.object_store import ObjectStore
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("knowledge.indexing")


@dataclass(frozen=True)
class IndexResult:
    indexed: int
    note: str | None = None


def _is_image_document(row: DocumentRow) -> bool:
    return (row.source_mime_type or "").lower().startswith("image/")


async def _maybe_append_image_chunk(
    new_rows: list[DocumentChunkRow],
    *,
    row: DocumentRow,
    user_id: str,
    embed_provider: ProviderSnapshot,
    pieces: list[str],
    now: datetime,
    embedding_dim: int,
) -> str | None:
    """Add an image-body vector (multimodal embedding) alongside the caption
    chunks. Shares the single pgvector column as text, so hybrid+rerank is
    unchanged. Best-effort: any problem degrades to caption-only.
    """
    if not _is_image_document(row):
        return None
    if not is_multimodal_embedding_model(embed_provider.model):
        # text embedding model can't vectorize pixels; caption-only is expected
        return None
    if not (row.object_bucket and row.object_key):
        return "image vector skipped: original object missing"

    bucket, key = row.object_bucket, row.object_key
    try:
        image_bytes = await anyio.to_thread.run_sync(lambda: ObjectStore().get_bytes(bucket=bucket, key=key))
        mime = (row.source_mime_type or "application/octet-stream").split(";")[0].strip().lower()
        data_uri = f"data:{mime};base64,{base64.b64encode(image_bytes).decode('utf-8')}"
        vector = await embed_image(data_uri, provider=embed_provider)
    except Exception as exc:  # best-effort: never fail indexing over the image side
        logger.warning("image embedding failed for %s: %s", row.id, exc)
        return f"image vector skipped: {str(exc)[:120]}"

    if len(vector) != embedding_dim:
        return f"image vector skipped: dim {len(vector)} != configured {embedding_dim}"

    name = row.source_filename or row.filename or "image"
    lexical = pieces[0] if pieces else name
    new_rows.append(
        DocumentChunkRow(
            id=chunk_crud.new_chunk_id(),
            document_id=row.id,
            user_id=user_id,
            chunk_index=len(new_rows),
            content=f"[图片] {name}\n\n{lexical}",
            contextualized_content=None,
            embedding=vector,
            token_count=estimate_tokens(lexical),
            embed_model=embed_provider.model,
            created_at=now,
        )
    )
    return None


async def index_document(session: AsyncSession, *, document_id: str, user_id: str) -> IndexResult:
    settings = get_settings()
    row = await document_crud.get_document(session, document_id, user_id)
    if row is None:
        return IndexResult(0, "document not found")

    text = (row.content_md or "").strip()
    if not text:
        await chunk_crud.delete_document_chunks(session, document_id)
        await session.commit()
        return IndexResult(0, "no text content")

    try:
        embed_provider = await get_admin_client().get_provider_by_kind(user_id=user_id, kind="embedding")
    except ProviderNotConfiguredError:
        return IndexResult(0, "no embedding provider configured")

    pieces = chunk_text(
        text,
        max_tokens=settings.chunk_max_tokens,
        overlap_tokens=settings.chunk_overlap_tokens,
    )
    if not pieces:
        await chunk_crud.delete_document_chunks(session, document_id)
        await session.commit()
        return IndexResult(0, "no chunks")

    contexts: list[str | None] = [None] * len(pieces)
    if settings.contextual_retrieval_enabled:
        try:
            chat_provider = await get_admin_client().get_provider(user_id=user_id)
            contexts = await contextualize_chunks(pieces, document_text=text, provider=chat_provider)
        except ProviderNotConfiguredError:
            logger.info("contextual retrieval skipped: no chat provider for user %s", user_id)
        except Exception:
            logger.warning("contextual retrieval failed for %s; using raw chunks", document_id)

    embed_inputs = [f"{ctx}\n\n{piece}" if ctx else piece for piece, ctx in zip(pieces, contexts, strict=True)]
    vectors = await embed_texts(embed_inputs, provider=embed_provider)
    if len(vectors) != len(pieces):
        return IndexResult(0, "embedding count mismatch")
    if vectors and len(vectors[0]) != settings.embedding_dim:
        return IndexResult(
            0,
            f"embedding dim {len(vectors[0])} != configured {settings.embedding_dim}; re-index after aligning",
        )

    now = datetime.now(UTC)
    new_rows = [
        DocumentChunkRow(
            id=chunk_crud.new_chunk_id(),
            document_id=document_id,
            user_id=user_id,
            chunk_index=index,
            content=pieces[index],
            contextualized_content=embed_inputs[index] if contexts[index] else None,
            embedding=vectors[index],
            token_count=estimate_tokens(pieces[index]),
            embed_model=embed_provider.model,
            created_at=now,
        )
        for index in range(len(pieces))
    ]

    image_note = await _maybe_append_image_chunk(
        new_rows,
        row=row,
        user_id=user_id,
        embed_provider=embed_provider,
        pieces=pieces,
        now=now,
        embedding_dim=settings.embedding_dim,
    )

    await chunk_crud.delete_document_chunks(session, document_id)
    await chunk_crud.insert_chunks(session, new_rows)
    await session.commit()
    return IndexResult(len(new_rows), image_note)
