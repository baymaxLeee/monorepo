"""Seed curated Agent Skills from anthropics/skills into the demo org."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import UTC, datetime
from uuid import uuid4

import httpx
from crud import skill_nodes as node_crud
from db import write_tx
from models.skill import SkillRow
from models.skill_node import SkillNodeRow
from models.skill_published_node import SkillPublishedNodeRow
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_DEMO_ORG_ID = "guest-org"
_DEMO_USER_ID = "demo-super-admin"
_DEMO_USERNAME = "admin"
_GITHUB_TREE_URL = "https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1"
_MAX_FILE_BYTES = 200_000
_MAX_NODES = 500
_SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip", ".pyc", ".woff", ".woff2"}

# High-frequency skills from anthropics/skills (official reference repo).
CURATED_SKILL_SLUGS: tuple[str, ...] = (
    "frontend-design",
    "mcp-builder",
    "skill-creator",
    "pdf",
    "webapp-testing",
    "doc-coauthoring",
    "internal-comms",
    "xlsx",
)

_FRONTMATTER = re.compile(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$")
_NAME_LINE = re.compile(r"^name:\s*(.+?)\s*$", re.MULTILINE)
_DESCRIPTION_LINE = re.compile(r"^description:\s*(.+?)\s*$", re.MULTILINE)
_SKILL_NAME = re.compile(r"^[a-z](?:[a-z0-9]|-(?=[a-z0-9]))*[a-z0-9]$|^[a-z]$")

_GITHUB_TREE_CACHE: list[dict[str, object]] | None = None


def _parse_skill_md(content: str) -> tuple[str, str]:
    match = _FRONTMATTER.match(content)
    if not match:
        raise ValueError("SKILL.md must start with YAML frontmatter")
    frontmatter, _ = match.groups()
    name = _NAME_LINE.search(frontmatter)
    description = _DESCRIPTION_LINE.search(frontmatter)
    if not name or not description:
        raise ValueError("SKILL.md frontmatter must declare name and description")

    def scalar(value: str) -> str:
        value = value.strip()
        if value.startswith('"'):
            parsed = json.loads(value)
            if not isinstance(parsed, str):
                raise ValueError("frontmatter description must be a string")
            return parsed
        if value.startswith("'") and value.endswith("'"):
            return value[1:-1].replace("''", "'")
        return value

    parsed_name = scalar(name.group(1))
    parsed_description = scalar(description.group(1))
    if not _SKILL_NAME.fullmatch(parsed_name):
        raise ValueError(f"invalid skill name: {parsed_name}")
    if not parsed_description or len(parsed_description) > 1024:
        raise ValueError(f"invalid skill description for {parsed_name}")
    return parsed_name, parsed_description


def _workspace_hash(nodes: list[SkillNodeRow]) -> str:
    by_id = {node.id: node for node in nodes}

    def path(node: SkillNodeRow) -> str:
        parts = [node.name]
        parent_id = node.parent_id
        seen = {node.id}
        while parent_id:
            if parent_id in seen or parent_id not in by_id:
                raise ValueError("invalid parent chain")
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


def _node_id(skill_id: str, rel_path: str) -> str:
    digest = hashlib.sha256(f"{skill_id}:{rel_path}".encode()).hexdigest()[:12]
    return f"n-{digest}"


def _mime_type(path: str) -> str:
    lower = path.lower()
    if lower.endswith(".md"):
        return "text/markdown"
    if lower.endswith((".py", ".xml", ".xsd", ".html", ".htm")):
        return "text/plain"
    return "text/plain"


def _dir_paths(file_paths: list[str]) -> list[str]:
    dirs: set[str] = set()
    for path in file_paths:
        parts = path.split("/")
        for index in range(1, len(parts)):
            dirs.add("/".join(parts[:index]))
    return sorted(dirs, key=lambda value: (value.count("/"), value))


async def _github_tree() -> list[dict[str, object]]:
    global _GITHUB_TREE_CACHE
    if _GITHUB_TREE_CACHE is not None:
        return _GITHUB_TREE_CACHE
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(_GITHUB_TREE_URL)
        response.raise_for_status()
        payload = response.json()
    _GITHUB_TREE_CACHE = list(payload.get("tree", []))
    return _GITHUB_TREE_CACHE


def _skill_blobs(slug: str, tree: list[dict[str, object]]) -> list[dict[str, object]]:
    prefix = f"skills/{slug}/"
    blobs: list[dict[str, object]] = []
    for entry in tree:
        path = str(entry.get("path", ""))
        if not path.startswith(prefix) or entry.get("type") != "blob":
            continue
        rel = path.removeprefix(prefix)
        if not rel or rel.endswith("/"):
            continue
        suffix = "." + rel.rsplit(".", 1)[-1].lower() if "." in rel else ""
        if suffix in _SKIP_SUFFIXES:
            continue
        size = int(entry.get("size") or 0)
        if size > _MAX_FILE_BYTES:
            logger.warning("skip oversized skill file %s (%s bytes)", path, size)
            continue
        blobs.append({"path": path, "rel": rel, "size": size})
    return sorted(blobs, key=lambda item: str(item["rel"]))


def _build_nodes(skill_id: str, files: dict[str, str], now: datetime) -> list[SkillNodeRow]:
    file_paths = sorted(files)
    if "SKILL.md" not in file_paths:
        raise ValueError("skill package must include root SKILL.md")

    dir_paths = _dir_paths(file_paths)
    total_nodes = len(dir_paths) + len(file_paths)
    if total_nodes > _MAX_NODES:
        raise ValueError(f"skill package exceeds {_MAX_NODES} nodes")

    path_to_id: dict[str, str] = {}
    nodes: list[SkillNodeRow] = []

    for index, rel_dir in enumerate(dir_paths):
        parent = "/".join(rel_dir.split("/")[:-1]) if "/" in rel_dir else None
        node = SkillNodeRow(
            id=_node_id(skill_id, rel_dir),
            skill_id=skill_id,
            parent_id=path_to_id[parent] if parent else None,
            name=rel_dir.rsplit("/", 1)[-1],
            node_type="directory",
            mime_type=None,
            content=None,
            sort_order=index,
            created_at=now,
            updated_at=now,
        )
        path_to_id[rel_dir] = node.id
        nodes.append(node)

    for index, rel_file in enumerate(file_paths):
        parent = "/".join(rel_file.split("/")[:-1]) if "/" in rel_file else None
        node = SkillNodeRow(
            id=_node_id(skill_id, rel_file),
            skill_id=skill_id,
            parent_id=path_to_id[parent] if parent else None,
            name=rel_file.rsplit("/", 1)[-1],
            node_type="file",
            mime_type=_mime_type(rel_file),
            content=files[rel_file],
            sort_order=index,
            created_at=now,
            updated_at=now,
        )
        path_to_id[rel_file] = node.id
        nodes.append(node)

    return nodes


async def _fetch_skill_package(slug: str) -> dict[str, str]:
    tree = await _github_tree()
    blobs = _skill_blobs(slug, tree)
    if not blobs:
        raise ValueError(f"no importable files found for skill {slug}")

    files: dict[str, str] = {}
    async with httpx.AsyncClient(timeout=60.0) as client:
        for blob in blobs:
            path = str(blob["path"])
            rel = str(blob["rel"])
            url = f"https://raw.githubusercontent.com/anthropics/skills/main/{path}"
            response = await client.get(url)
            response.raise_for_status()
            text = response.text
            if len(text.encode()) > _MAX_FILE_BYTES:
                logger.warning("skip oversized fetched file %s", path)
                continue
            files[rel] = text
    return files


async def _replace_published_snapshot(session: AsyncSession, skill_id: str) -> None:
    await session.execute(delete(SkillPublishedNodeRow).where(SkillPublishedNodeRow.skill_id == skill_id))
    await node_crud.replace_published_nodes(session, skill_id)


async def _upsert_published_skill(session: AsyncSession, *, slug: str) -> str:
    files = await _fetch_skill_package(slug)
    name, description = _parse_skill_md(files["SKILL.md"])

    existing = await session.scalar(
        select(SkillRow).where(SkillRow.org_id == _DEMO_ORG_ID, SkillRow.name == name)
    )
    now = datetime.now(UTC)

    if existing is None:
        skill_id = f"sk-{slug[:20]}"
        if await session.get(SkillRow, skill_id) is not None:
            skill_id = uuid4().hex[:8]
        row = SkillRow(
            id=skill_id,
            user_id=_DEMO_USER_ID,
            org_id=_DEMO_ORG_ID,
            username=_DEMO_USERNAME,
            name=name,
            description=description,
            status="published",
            is_enabled=True,
            workspace_seq=1,
            workspace_sha256=None,
            published_sha256=None,
            published_at=now,
            published_name=name,
            published_description=description,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        await session.flush()
    else:
        row = existing
        skill_id = row.id
        await session.execute(delete(SkillPublishedNodeRow).where(SkillPublishedNodeRow.skill_id == skill_id))
        await session.execute(delete(SkillNodeRow).where(SkillNodeRow.skill_id == skill_id))
        await session.flush()
        row.description = description
        row.status = "published"
        row.is_enabled = True
        row.published_name = name
        row.published_description = description
        row.updated_at = now

    nodes = _build_nodes(skill_id, files, now)
    session.add_all(nodes)
    await session.flush()

    workspace_hash = _workspace_hash(nodes)
    row.workspace_sha256 = workspace_hash
    row.published_sha256 = workspace_hash
    row.published_at = now
    row.workspace_seq = (row.workspace_seq or 0) + 1
    row.updated_at = now
    await _replace_published_snapshot(session, skill_id)
    return name


async def seed_demo_skills() -> list[str]:
    synced: list[str] = []
    from db import get_session_factory

    factory = get_session_factory()
    async with factory() as session, write_tx(session):
        for slug in CURATED_SKILL_SLUGS:
            try:
                name = await _upsert_published_skill(session, slug=slug)
                synced.append(name)
                logger.info("synced demo skill %s from anthropics/skills", name)
            except Exception as error:
                logger.warning("failed to sync demo skill %s: %s", slug, error)
    return synced
