"""Artifact slot parsing for inline [docId] references in prompts and messages."""

from __future__ import annotations

import re

ARTIFACT_SLOT_RE = re.compile(r"\[([a-f0-9]{16})\]")
LEGACY_DOCUMENT_REF_RE = re.compile(r"\[\[chat-document:([a-zA-Z0-9_-]+)\]\]")


def extract_slot_ids(content: str) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for pattern in (ARTIFACT_SLOT_RE, LEGACY_DOCUMENT_REF_RE):
        for match in pattern.finditer(content):
            document_id = match.group(1)
            if document_id in seen:
                continue
            seen.add(document_id)
            ids.append(document_id)
    return ids
