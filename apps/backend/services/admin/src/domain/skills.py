from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Sequence
from typing import Protocol

from kernel.errors import RequestError

_FRONTMATTER = re.compile(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$")
_NAME_LINE = re.compile(r"^name:\s*(.+?)\s*$", re.MULTILINE)
_DESCRIPTION_LINE = re.compile(r"^description:\s*(.+?)\s*$", re.MULTILINE)
_SKILL_NAME = re.compile(r"^[a-z](?:[a-z0-9]|-(?=[a-z0-9]))*[a-z0-9]$|^[a-z]$")


class WorkspaceNode(Protocol):
    id: str
    parent_id: str | None
    name: str
    node_type: str
    mime_type: str | None
    content: str | None


class PublishedNode(Protocol):
    node_id: str
    parent_node_id: str | None
    name: str


def parse_skill_md(content: str) -> tuple[str, str, str]:
    match = _FRONTMATTER.match(content)
    if not match:
        raise RequestError("SKILL.md must start with YAML frontmatter")
    frontmatter, body = match.groups()
    name = _NAME_LINE.search(frontmatter)
    description = _DESCRIPTION_LINE.search(frontmatter)
    if not name or not description:
        raise RequestError("SKILL.md frontmatter must declare name and description")

    def scalar(value: str) -> str:
        value = value.strip()
        if value.startswith('"'):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as error:
                raise RequestError(f"invalid quoted frontmatter value: {error}") from error
            if not isinstance(parsed, str):
                raise RequestError("frontmatter name and description must be strings")
            return parsed
        if value.startswith("'") and value.endswith("'"):
            return value[1:-1].replace("''", "'")
        return value

    parsed_name = scalar(name.group(1))
    parsed_description = scalar(description.group(1))
    if not _SKILL_NAME.fullmatch(parsed_name):
        raise RequestError("SKILL.md name must use lowercase letters, digits and single hyphens")
    if not parsed_description or len(parsed_description) > 1024:
        raise RequestError("SKILL.md description must contain 1-1024 characters")
    return parsed_name, parsed_description, body.strip()


def workspace_hash(nodes: Sequence[WorkspaceNode]) -> str:
    by_id = {node.id: node for node in nodes}

    def path(node: WorkspaceNode) -> str:
        parts = [node.name]
        parent_id = node.parent_id
        seen = {node.id}
        while parent_id:
            if parent_id in seen or parent_id not in by_id:
                raise RequestError("skill workspace contains an invalid parent chain")
            seen.add(parent_id)
            parent = by_id[parent_id]
            parts.append(parent.name)
            parent_id = parent.parent_id
        return "/".join(reversed(parts))

    digest = hashlib.sha256()
    for node in sorted(nodes, key=path):
        digest.update(path(node).encode())
        digest.update(b"\0")
        digest.update(node.node_type.encode())
        digest.update(b"\0")
        digest.update((node.content or "").encode())
        digest.update(b"\0")
    return digest.hexdigest()


def node_etag(node: WorkspaceNode) -> str:
    digest = hashlib.sha256()
    for value in (
        node.id,
        node.parent_id or "",
        node.name,
        node.node_type,
        node.mime_type or "",
        node.content or "",
    ):
        digest.update(value.encode())
        digest.update(b"\0")
    return digest.hexdigest()


def validate_node_name(name: str) -> None:
    if name in {".", ".."} or "/" in name or "\\" in name:
        raise RequestError("file names may not contain path separators")


def root_skill_md[WorkspaceNodeT: WorkspaceNode](nodes: Sequence[WorkspaceNodeT]) -> WorkspaceNodeT:
    matches = [
        node for node in nodes if node.parent_id is None and node.name == "SKILL.md" and node.node_type == "file"
    ]
    if len(matches) != 1:
        raise RequestError("workspace must contain exactly one root SKILL.md")
    return matches[0]


def validate_workspace[WorkspaceNodeT: WorkspaceNode](nodes: Sequence[WorkspaceNodeT]) -> WorkspaceNodeT:
    if len(nodes) > 500:
        raise RequestError("a skill may contain at most 500 nodes")
    by_id = {node.id: node for node in nodes}
    for node in nodes:
        if node.parent_id and node.parent_id not in by_id:
            raise RequestError(f"node {node.name} has a missing parent")
        if node.parent_id and by_id[node.parent_id].node_type != "directory":
            raise RequestError(f"node {node.name} parent is not a directory")
    workspace_hash(nodes)
    return root_skill_md(nodes)


def published_paths(nodes: Sequence[PublishedNode]) -> dict[str, str]:
    by_id = {node.node_id: node for node in nodes}
    result: dict[str, str] = {}
    for node_id, node in by_id.items():
        parts = [node.name]
        parent_id = node.parent_node_id
        seen = {node_id}
        while parent_id:
            if parent_id in seen or parent_id not in by_id:
                raise RequestError("published skill contains an invalid parent chain")
            seen.add(parent_id)
            parent = by_id[parent_id]
            parts.append(parent.name)
            parent_id = parent.parent_node_id
        result[node_id] = "/".join(reversed(parts))
    return result
