"""Skill workspace and publishing orchestration."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

from infrastructure.persistence.database import write_tx
from infrastructure.persistence.models.skill import SkillRow
from infrastructure.persistence.models.skill_node import SkillNodeRow
from infrastructure.persistence.models.skill_published_node import SkillPublishedNodeRow
from infrastructure.persistence.repositories import skill_nodes as node_crud
from infrastructure.persistence.repositories import skills as skill_crud
from kernel.errors import ConflictError, NotFoundError, RequestError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from application.auth import AuthContext
from application.contracts.skill import (
    CreateSkillInput,
    CreateSkillNodeInput,
    InternalSkill,
    InternalSkillFile,
    MoveSkillNodeInput,
    PublishSkillInput,
    PublishSkillResult,
    RenameSkillNodeInput,
    Skill,
    SkillFileContent,
    SkillFileNode,
    SkillNodeMutationResult,
    SkillSummary,
    SkillValidationIssue,
    SkillValidationResult,
    SkillWorkspace,
    UpdateSkillFileContentInput,
    UpdateSkillInput,
)

_FRONTMATTER = re.compile(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$")
_NAME_LINE = re.compile(r"^name:\s*(.+?)\s*$", re.MULTILINE)
_DESCRIPTION_LINE = re.compile(r"^description:\s*(.+?)\s*$", re.MULTILINE)
_SKILL_NAME = re.compile(r"^[a-z](?:[a-z0-9]|-(?=[a-z0-9]))*[a-z0-9]$|^[a-z]$")


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def _summary_fields(row: SkillRow) -> dict[str, object]:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "org_id": row.org_id,
        "username": row.username,
        "name": row.name,
        "description": row.description,
        "status": row.status,
        "is_enabled": row.is_enabled,
        "has_unpublished_changes": row.workspace_sha256 != row.published_sha256,
        "published_at": _iso(row.published_at),
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


def to_schema(row: SkillRow) -> Skill:
    return Skill(**_summary_fields(row), workspace_seq=row.workspace_seq)  # type: ignore[arg-type]


def to_summary(row: SkillRow) -> SkillSummary:
    return SkillSummary(**_summary_fields(row))  # type: ignore[arg-type]


def _parse_skill_md(content: str) -> tuple[str, str, str]:
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


def _workspace_hash(nodes: Sequence[SkillNodeRow]) -> str:
    by_id = {node.id: node for node in nodes}

    def path(node: SkillNodeRow) -> str:
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


def _node_etag(node: SkillNodeRow) -> str:
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


def _build_tree(nodes: Sequence[SkillNodeRow], *, include_content: bool) -> list[SkillFileNode]:
    children: dict[str | None, list[SkillNodeRow]] = {}
    for node in nodes:
        children.setdefault(node.parent_id, []).append(node)

    def build(node: SkillNodeRow) -> SkillFileNode:
        nested = [build(child) for child in children.get(node.id, [])]
        return SkillFileNode(
            id=node.id,
            name=node.name,
            type=node.node_type,  # type: ignore[arg-type]
            parent_id=node.parent_id,
            mime_type=node.mime_type,
            etag=_node_etag(node),
            content=node.content if include_content and node.node_type == "file" else None,
            children=nested if node.node_type == "directory" else None,
        )

    return [build(node) for node in children.get(None, [])]


class SkillService:
    def __init__(self, session: AsyncSession, current_user: AuthContext) -> None:
        self._session = session
        self._current_user = current_user

    async def list(self) -> list[SkillSummary]:
        rows = await skill_crud.list_skills(self._session, self._current_user.org_id)
        return [to_summary(row) for row in rows]

    async def get(self, skill_id: str) -> Skill:
        return to_schema(await self._get_row(skill_id))

    async def create(self, payload: CreateSkillInput) -> Skill:
        async with write_tx(self._session):
            await self._assert_name_free(payload.name)
            row = await skill_crud.create_skill(
                self._session,
                name=payload.name,
                description=payload.description,
                user_id=self._current_user.user_id,
                org_id=self._current_user.org_id,
                username=self._current_user.username,
            )
            now = datetime.now(UTC)
            description = json.dumps(payload.description, ensure_ascii=False)
            content = (
                f"---\nname: {payload.name}\ndescription: {description}\n---\n\n"
                f"# {payload.name}\n\n## Instructions\n\nDescribe the reusable workflow here.\n"
            )
            node = SkillNodeRow(
                id=uuid4().hex[:12],
                skill_id=row.id,
                parent_id=None,
                name="SKILL.md",
                node_type="file",
                mime_type="text/markdown",
                content=content,
                sort_order=0,
                created_at=now,
                updated_at=now,
            )
            self._session.add(node)
            await self._session.flush()
            row.workspace_sha256 = _workspace_hash([node])
        return to_schema(row)

    async def update(self, skill_id: str, payload: UpdateSkillInput) -> Skill:
        async with write_tx(self._session):
            row = await self._get_locked_row(skill_id)
            for key, value in payload.model_dump(exclude_unset=True).items():
                setattr(row, key, value)
            row.updated_at = datetime.now(UTC)
            await self._session.flush()
        return to_schema(row)

    async def get_workspace(self, skill_id: str) -> SkillWorkspace:
        row = await self._get_row(skill_id)
        nodes = await node_crud.list_workspace_nodes(self._session, skill_id)
        return SkillWorkspace(
            skill_id=skill_id,
            workspace_seq=row.workspace_seq,
            tree=_build_tree(nodes, include_content=False),
        )

    async def get_file(self, skill_id: str, node_id: str) -> SkillFileContent:
        await self._get_row(skill_id)
        node = await node_crud.get_workspace_node(self._session, skill_id, node_id)
        if node is None or node.node_type != "file":
            raise NotFoundError(f"skill file {node_id} not found")
        return SkillFileContent(id=node.id, content=node.content or "", etag=_node_etag(node))

    async def create_node(self, skill_id: str, payload: CreateSkillNodeInput) -> SkillNodeMutationResult:
        async with write_tx(self._session):
            row = await self._get_locked_row(skill_id)
            if await node_crud.get_workspace_node(self._session, skill_id, payload.id):
                raise ConflictError(f"skill node {payload.id} already exists")
            await self._assert_parent_directory(skill_id, payload.parent_id)
            await self._assert_sibling_name_free(skill_id, payload.parent_id, payload.name)
            self._validate_node_name(payload.name)
            now = datetime.now(UTC)
            node = SkillNodeRow(
                id=payload.id,
                skill_id=skill_id,
                parent_id=payload.parent_id,
                name=payload.name,
                node_type=payload.type,
                mime_type="text/markdown" if payload.name.endswith(".md") else "text/plain",
                content=(payload.content or "") if payload.type == "file" else None,
                sort_order=0,
                created_at=now,
                updated_at=now,
            )
            self._session.add(node)
            await self._session.flush()
            await self._finish_draft_mutation(row)
        return SkillNodeMutationResult(workspace_seq=row.workspace_seq, node_id=node.id, etag=_node_etag(node))

    async def update_file_content(
        self, skill_id: str, node_id: str, payload: UpdateSkillFileContentInput
    ) -> SkillNodeMutationResult:
        async with write_tx(self._session):
            row = await self._get_locked_row(skill_id)
            node = await self._get_node(skill_id, node_id)
            self._assert_node_etag(node, payload.base_etag)
            if node.node_type != "file":
                raise RequestError("only files have editable content")
            node.content = payload.content
            node.updated_at = datetime.now(UTC)
            await self._session.flush()
            await self._finish_draft_mutation(row)
        return SkillNodeMutationResult(workspace_seq=row.workspace_seq, node_id=node.id, etag=_node_etag(node))

    async def rename_node(self, skill_id: str, node_id: str, payload: RenameSkillNodeInput) -> SkillNodeMutationResult:
        async with write_tx(self._session):
            row = await self._get_locked_row(skill_id)
            node = await self._get_node(skill_id, node_id)
            self._assert_node_etag(node, payload.base_etag)
            self._assert_mutable_root(node, "renamed")
            self._validate_node_name(payload.name)
            await self._assert_sibling_name_free(skill_id, node.parent_id, payload.name, excluding_id=node.id)
            node.name = payload.name
            node.mime_type = "text/markdown" if payload.name.endswith(".md") else "text/plain"
            node.updated_at = datetime.now(UTC)
            await self._session.flush()
            await self._finish_draft_mutation(row)
        return SkillNodeMutationResult(workspace_seq=row.workspace_seq, node_id=node.id, etag=_node_etag(node))

    async def move_node(self, skill_id: str, node_id: str, payload: MoveSkillNodeInput) -> SkillNodeMutationResult:
        async with write_tx(self._session):
            row = await self._get_locked_row(skill_id)
            node = await self._get_node(skill_id, node_id)
            self._assert_node_etag(node, payload.base_etag)
            self._assert_mutable_root(node, "moved")
            if payload.parent_id == node.id:
                raise RequestError("a node cannot be its own parent")
            await self._assert_parent_directory(skill_id, payload.parent_id)
            await self._assert_sibling_name_free(skill_id, payload.parent_id, node.name, excluding_id=node.id)
            node.parent_id = payload.parent_id
            node.updated_at = datetime.now(UTC)
            await self._session.flush()
            await self._finish_draft_mutation(row)
        return SkillNodeMutationResult(workspace_seq=row.workspace_seq, node_id=node.id, etag=_node_etag(node))

    async def delete_node(self, skill_id: str, node_id: str, base_etag: str) -> SkillNodeMutationResult:
        async with write_tx(self._session):
            row = await self._get_locked_row(skill_id)
            node = await self._get_node(skill_id, node_id)
            self._assert_node_etag(node, base_etag)
            self._assert_mutable_root(node, "deleted")
            await self._session.delete(node)
            await self._session.flush()
            await self._finish_draft_mutation(row)
        return SkillNodeMutationResult(workspace_seq=row.workspace_seq, node_id=node_id)

    async def validate(self, skill_id: str) -> SkillValidationResult:
        await self._get_row(skill_id)
        nodes = await node_crud.list_workspace_nodes(self._session, skill_id)
        return self._validation_result(nodes)

    async def publish(self, skill_id: str, payload: PublishSkillInput) -> PublishSkillResult:
        async with write_tx(self._session):
            row = await self._get_locked_row(skill_id)
            self._assert_workspace_seq(row, payload.base_workspace_seq)
            nodes = await node_crud.list_workspace_nodes(self._session, skill_id)
            validation = self._validation_result(nodes)
            if not validation.ok:
                raise RequestError(
                    "skill validation failed",
                    details={"issues": [issue.model_dump() for issue in validation.issues]},
                )
            await node_crud.replace_published_nodes(self._session, skill_id)
            row.status = "published"
            row.published_sha256 = row.workspace_sha256
            row.published_at = datetime.now(UTC)
            row.published_name = row.name
            row.published_description = row.description
            row.updated_at = row.published_at
            await self._session.flush()
        return PublishSkillResult(skill=to_schema(row), validation=validation)

    async def delete(self, skill_id: str) -> None:
        async with write_tx(self._session):
            await skill_crud.delete_skill(self._session, await self._get_row(skill_id))

    async def bulk_delete(self, ids: Sequence[str]) -> int:
        async with write_tx(self._session):
            return await skill_crud.bulk_delete_skills(self._session, list(ids), self._current_user.org_id)

    async def get_internal(self, skill_id: str, org_id: str) -> InternalSkill:
        row = await skill_crud.get_skill(self._session, skill_id, org_id)
        if row is None or row.status != "published" or not row.is_enabled:
            raise NotFoundError(f"published skill {skill_id} not found")
        nodes = await node_crud.list_published_nodes(self._session, skill_id)
        skill_md = next(
            (
                node
                for node in nodes
                if node.parent_node_id is None and node.name == "SKILL.md" and node.node_type == "file"
            ),
            None,
        )
        if skill_md is None:
            raise NotFoundError(f"published skill {skill_id} has no SKILL.md")
        name, description, body = _parse_skill_md(skill_md.content or "")
        paths = self._published_paths(nodes)
        return InternalSkill(
            id=row.id,
            name=name,
            description=description,
            body=body,
            files=sorted(path for path in paths.values() if path != "SKILL.md"),
        )

    async def get_internal_file(self, skill_id: str, org_id: str, path: str) -> InternalSkillFile:
        row = await skill_crud.get_skill(self._session, skill_id, org_id)
        if row is None or row.status != "published" or not row.is_enabled:
            raise NotFoundError(f"published skill {skill_id} not found")
        nodes = await node_crud.list_published_nodes(self._session, skill_id)
        paths = self._published_paths(nodes)
        node = next((node for node in nodes if paths.get(node.node_id) == path), None)
        if node is None or node.node_type != "file":
            raise NotFoundError(f"published skill file {path} not found")
        return InternalSkillFile(path=path, content=node.content or "")

    async def _finish_draft_mutation(self, row: SkillRow) -> None:
        nodes = await node_crud.list_workspace_nodes(self._session, row.id)
        self._validate_structure(nodes)
        skill_md = self._root_skill_md(nodes)
        try:
            name, description, _ = _parse_skill_md(skill_md.content or "")
        except RequestError:
            pass
        else:
            if name != row.name:
                await self._assert_name_free(name, excluding_id=row.id)
            row.name = name
            row.description = description
        row.workspace_seq += 1
        row.workspace_sha256 = _workspace_hash(nodes)
        row.updated_at = datetime.now(UTC)
        await self._session.flush()

    async def _get_node(self, skill_id: str, node_id: str) -> SkillNodeRow:
        node = await node_crud.get_workspace_node(self._session, skill_id, node_id)
        if node is None:
            raise NotFoundError(f"skill node {node_id} not found")
        return node

    async def _assert_parent_directory(self, skill_id: str, parent_id: str | None) -> None:
        if parent_id is None:
            return
        parent = await self._get_node(skill_id, parent_id)
        if parent.node_type != "directory":
            raise RequestError("parent must be a directory")

    async def _assert_sibling_name_free(
        self,
        skill_id: str,
        parent_id: str | None,
        name: str,
        *,
        excluding_id: str | None = None,
    ) -> None:
        parent_filter = SkillNodeRow.parent_id.is_(None) if parent_id is None else SkillNodeRow.parent_id == parent_id
        stmt = select(SkillNodeRow.id).where(
            SkillNodeRow.skill_id == skill_id,
            parent_filter,
            SkillNodeRow.name == name,
        )
        if excluding_id:
            stmt = stmt.where(SkillNodeRow.id != excluding_id)
        if await self._session.scalar(stmt) is not None:
            raise ConflictError(f"a node named '{name}' already exists in this directory")

    @staticmethod
    def _assert_node_etag(node: SkillNodeRow, expected: str) -> None:
        current = _node_etag(node)
        if current != expected:
            raise ConflictError(
                f"skill node {node.id} changed in another session",
                details={"expected": expected, "current": current},
            )

    @staticmethod
    def _validate_node_name(name: str) -> None:
        if name in {".", ".."} or "/" in name or "\\" in name:
            raise RequestError("file names may not contain path separators")

    @staticmethod
    def _assert_mutable_root(node: SkillNodeRow, action: str) -> None:
        if node.parent_id is None and node.name == "SKILL.md":
            raise RequestError(f"root SKILL.md cannot be {action}")

    def _validation_result(self, nodes: Sequence[SkillNodeRow]) -> SkillValidationResult:
        issues: list[SkillValidationIssue] = []
        try:
            self._validate_structure(nodes)
            skill_md = self._root_skill_md(nodes)
            _parse_skill_md(skill_md.content or "")
        except RequestError as error:
            issues.append(SkillValidationIssue(path="SKILL.md", message=error.message))
        return SkillValidationResult(ok=not issues, issues=issues)

    def _validate_structure(self, nodes: Sequence[SkillNodeRow]) -> None:
        if len(nodes) > 500:
            raise RequestError("a skill may contain at most 500 nodes")
        by_id = {node.id: node for node in nodes}
        for node in nodes:
            if node.parent_id and node.parent_id not in by_id:
                raise RequestError(f"node {node.name} has a missing parent")
            if node.parent_id and by_id[node.parent_id].node_type != "directory":
                raise RequestError(f"node {node.name} parent is not a directory")
        _workspace_hash(nodes)
        self._root_skill_md(nodes)

    @staticmethod
    def _root_skill_md(nodes: Sequence[SkillNodeRow]) -> SkillNodeRow:
        matches = [
            node for node in nodes if node.parent_id is None and node.name == "SKILL.md" and node.node_type == "file"
        ]
        if len(matches) != 1:
            raise RequestError("workspace must contain exactly one root SKILL.md")
        return matches[0]

    @staticmethod
    def _published_paths(nodes: Sequence[SkillPublishedNodeRow]) -> dict[str, str]:
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

    @staticmethod
    def _assert_workspace_seq(row: SkillRow, expected: int) -> None:
        if row.workspace_seq != expected:
            raise ConflictError(
                "skill workspace changed in another session",
                details={"expected": expected, "current": row.workspace_seq},
            )

    async def _assert_name_free(self, name: str, excluding_id: str | None = None) -> None:
        existing = await skill_crud.get_skill_by_name(self._session, self._current_user.org_id, name)
        if existing is not None and existing.id != excluding_id:
            raise RequestError(f"a skill named '{name}' already exists in this team")

    async def _get_row(self, skill_id: str) -> SkillRow:
        row = await skill_crud.get_skill(self._session, skill_id, self._current_user.org_id)
        if row is None:
            raise NotFoundError(f"skill {skill_id} not found")
        return row

    async def _get_locked_row(self, skill_id: str) -> SkillRow:
        row = await self._session.scalar(
            select(SkillRow)
            .where(SkillRow.id == skill_id, SkillRow.org_id == self._current_user.org_id)
            .with_for_update()
        )
        if row is None:
            raise NotFoundError(f"skill {skill_id} not found")
        return row
