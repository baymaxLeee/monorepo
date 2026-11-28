"""Recursive text chunking for RAG indexing.

Dependency-free recursive splitter: pack paragraphs/sentences into chunks near a
token target, with a small overlap so a fact split across a boundary still lands
whole in one chunk. ASCII text is approximated at four characters per token,
while CJK and other non-ASCII code points are conservatively counted as one token
each. This avoids the severe over-sized chunks produced by a global 4 chars/token
assumption for Chinese documents.
"""

from __future__ import annotations

_CHARS_PER_TOKEN = 4
_SEPARATORS = ["\n\n", "\n", "。", "！", "？", ". ", "! ", "? ", "；", "; ", " "]


def _token_units(text: str) -> int:
    """Return quarter-token units without taking a tokenizer dependency."""
    return sum(1 if ord(char) < 128 else _CHARS_PER_TOKEN for char in text)


def _split_hard(text: str, limit: int) -> list[str]:
    pieces: list[str] = []
    start = 0
    units = 0
    for index, char in enumerate(text):
        char_units = 1 if ord(char) < 128 else _CHARS_PER_TOKEN
        if units and units + char_units > limit:
            pieces.append(text[start:index])
            start = index
            units = 0
        units += char_units
    if start < len(text):
        pieces.append(text[start:])
    return pieces


def _split_recursive(text: str, limit: int) -> list[str]:
    if _token_units(text) <= limit:
        return [text]
    for sep in _SEPARATORS:
        if sep and sep in text:
            parts = text.split(sep)
            pieces: list[str] = []
            for i, part in enumerate(parts):
                piece = part + (sep if i < len(parts) - 1 else "")
                if not piece:
                    continue
                if _token_units(piece) <= limit:
                    pieces.append(piece)
                else:
                    pieces.extend(_split_recursive(piece, limit))
            return pieces
    return _split_hard(text, limit)


def _suffix_within(text: str, limit: int) -> str:
    units = 0
    start = len(text)
    for index in range(len(text) - 1, -1, -1):
        char = text[index]
        char_units = 1 if ord(char) < 128 else _CHARS_PER_TOKEN
        if units + char_units > limit:
            break
        units += char_units
        start = index
    return text[start:]


def chunk_text(text: str, *, max_tokens: int = 512, overlap_tokens: int = 64) -> list[str]:
    """Split text into overlapping chunks of ~max_tokens each."""
    normalized = text.strip()
    if not normalized:
        return []
    max_units = max(max_tokens * _CHARS_PER_TOKEN, 1)
    overlap_units = max(min(overlap_tokens, max_tokens // 2) * _CHARS_PER_TOKEN, 0)

    pieces = _split_recursive(normalized, max_units)

    chunks: list[str] = []
    buffer = ""
    for piece in pieces:
        if not buffer:
            buffer = piece
        elif _token_units(buffer) + _token_units(piece) <= max_units:
            buffer += piece
        else:
            chunks.append(buffer.strip())
            remaining_units = max(max_units - _token_units(piece), 0)
            tail_limit = min(overlap_units, remaining_units)
            tail = _suffix_within(buffer, tail_limit) if tail_limit else ""
            buffer = (tail + piece) if tail else piece
    if buffer.strip():
        chunks.append(buffer.strip())
    return [c for c in chunks if c]


def estimate_tokens(text: str) -> int:
    return max((_token_units(text) + _CHARS_PER_TOKEN - 1) // _CHARS_PER_TOKEN, 1)
