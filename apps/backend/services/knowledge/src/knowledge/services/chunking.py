"""Recursive text chunking for RAG indexing.

Dependency-free recursive splitter: pack paragraphs/sentences into chunks near a
token target (recursive ~512 tokens is a strong 2026 baseline), with a small
overlap so a fact split across a boundary still lands whole in one chunk. Token
counts are approximated at ~4 chars/token, which is a safe upper bound for
sizing (it slightly under-fills for CJK, which is fine).
"""

from __future__ import annotations

_CHARS_PER_TOKEN = 4
_SEPARATORS = ["\n\n", "\n", "。", "！", "？", ". ", "! ", "? ", "；", "; ", " "]  # noqa: RUF001


def _split_recursive(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    for sep in _SEPARATORS:
        if sep and sep in text:
            parts = text.split(sep)
            pieces: list[str] = []
            for i, part in enumerate(parts):
                piece = part + (sep if i < len(parts) - 1 else "")
                if not piece:
                    continue
                if len(piece) <= limit:
                    pieces.append(piece)
                else:
                    pieces.extend(_split_recursive(piece, limit))
            return pieces
    return [text[i : i + limit] for i in range(0, len(text), limit)]


def chunk_text(text: str, *, max_tokens: int = 512, overlap_tokens: int = 64) -> list[str]:
    """Split text into overlapping chunks of ~max_tokens each."""
    normalized = text.strip()
    if not normalized:
        return []
    max_chars = max(max_tokens * _CHARS_PER_TOKEN, 200)
    overlap_chars = max(min(overlap_tokens, max_tokens // 2) * _CHARS_PER_TOKEN, 0)

    pieces = _split_recursive(normalized, max_chars)

    chunks: list[str] = []
    buffer = ""
    for piece in pieces:
        if not buffer:
            buffer = piece
        elif len(buffer) + len(piece) <= max_chars:
            buffer += piece
        else:
            chunks.append(buffer.strip())
            tail = buffer[-overlap_chars:] if overlap_chars else ""
            buffer = (tail + piece) if tail else piece
    if buffer.strip():
        chunks.append(buffer.strip())
    return [c for c in chunks if c]


def estimate_tokens(text: str) -> int:
    return max(len(text) // _CHARS_PER_TOKEN, 1)
