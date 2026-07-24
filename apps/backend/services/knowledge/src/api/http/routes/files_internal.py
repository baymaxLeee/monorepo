"""Internal virtual-file API shared by Chat and Executor."""

import fnmatch
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from hashlib import sha256
from uuid import uuid4

from application.contracts.file_store import (
    ChangeSet,
    CreateChangeSetInput,
    FileEntry,
    FileRead,
    FileSearchInput,
    FileSearchMatch,
    PromoteChangeSetInput,
    WriteChangeSetFileInput,
)
from fastapi import APIRouter, Depends, Query
from infrastructure.persistence.database import write_tx
from infrastructure.persistence.models.document import DocumentRow
from infrastructure.persistence.models.file_store import FileChangeSetEntryRow, FileChangeSetRow, FileEntryRow
from kernel.errors import ConflictError, NotFoundError, RequestError
from sqlalchemy import select, text

from api.http.dependencies import DbSession, require_internal_token

router = APIRouter(prefix="/internal/files", tags=["files"], dependencies=[Depends(require_internal_token)])


def _id() -> str:
    return uuid4().hex[:26]


def _path(value: str) -> str:
    path = value.strip().replace("\\", "/")
    if not path or path.startswith("/") or ".." in path.split("/") or any(not part for part in path.split("/")):
        raise RequestError("invalid virtual file path")
    return path


def _source_path(row: DocumentRow) -> str:
    filename = re.sub(r"[^a-zA-Z0-9._\-\u4e00-\u9fff]+", "-", row.source_filename or row.filename).strip("-.")
    return f"sources/{row.id[:8]}-{filename or 'file'}"


def _entry(row: FileEntryRow | FileChangeSetEntryRow) -> FileEntry:
    return FileEntry(
        path=row.path,
        mime_type=row.mime_type,
        size=len(row.content.encode()),
        sha256=row.sha256,
        writable=row.writable,
        derived=row.derived,
    )


def _in_root(path: str, root: str | None) -> bool:
    if not root:
        return True
    return path.startswith(root) if root.endswith("/") else path == root


def _change_set_root(metadata: Mapping[str, object] | None) -> str | None:
    value = metadata.get("root") if metadata else None
    if not isinstance(value, str) or not value:
        return None
    is_directory = value.endswith("/")
    normalized = _path(value.rstrip("/"))
    return f"{normalized}/" if is_directory else normalized


@router.get("", response_model=list[FileEntry])
async def list_files(
    session: DbSession,
    user_id: str = Query(...),
    conversation_id: str = Query(...),
    path: str | None = Query(default=None),
) -> list[FileEntry]:
    prefix = f"{_path(path.rstrip('/'))}/" if path else ""
    rows = (await session.scalars(select(FileEntryRow).where(
        FileEntryRow.user_id == user_id,
        FileEntryRow.conversation_id == conversation_id,
    ).order_by(FileEntryRow.path))).all()
    sources = (await session.scalars(select(DocumentRow).where(
        DocumentRow.user_id == user_id,
        DocumentRow.conversation_id == conversation_id,
        DocumentRow.kind == "source",
    ).order_by(DocumentRow.created_at, DocumentRow.id))).all()
    entries = [_entry(row) for row in rows if not prefix or row.path.startswith(prefix)]
    for source in sources:
        source_path = _source_path(source)
        if prefix and not source_path.startswith(prefix):
            continue
        content = source.content_md
        entries.append(FileEntry(
            path=source_path,
            mime_type=source.source_mime_type or source.mime_type,
            size=source.source_size,
            sha256=source.object_sha256 or sha256(content.encode()).hexdigest(),
            writable=False,
            derived=False,
        ))
    return sorted(entries, key=lambda entry: entry.path)


@router.get("/read", response_model=FileRead)
async def read_file(
    session: DbSession,
    user_id: str = Query(...),
    conversation_id: str = Query(...),
    path: str = Query(...),
    offset: int = Query(default=1, ge=1),
    limit: int = Query(default=200, ge=1, le=400),
) -> FileRead:
    target = _path(path)
    row = await session.scalar(select(FileEntryRow).where(
        FileEntryRow.user_id == user_id, FileEntryRow.conversation_id == conversation_id, FileEntryRow.path == target,
    ))
    if row is None:
        sources = (await session.scalars(select(DocumentRow).where(
            DocumentRow.user_id == user_id,
            DocumentRow.conversation_id == conversation_id,
            DocumentRow.kind == "source",
        ))).all()
        source = next((candidate for candidate in sources if _source_path(candidate) == target), None)
        if source is None:
            raise NotFoundError(f"file {target} not found")
        content = source.content_md
        entry = FileEntry(
            path=target,
            mime_type=source.source_mime_type or source.mime_type,
            size=source.source_size,
            sha256=source.object_sha256 or sha256(content.encode()).hexdigest(),
            writable=False,
            derived=False,
        )
    else:
        content = row.content
        entry = _entry(row)
    lines = content.split("\n")
    start = offset - 1
    content = "\n".join(lines[start : start + limit])
    return FileRead(**entry.model_dump(), offset=offset, total_lines=len(lines), next_offset=start + limit + 1 if start + limit < len(lines) else None, content=content)


@router.post("/change-sets", response_model=ChangeSet, status_code=201)
async def create_change_set(payload: CreateChangeSetInput, session: DbSession) -> ChangeSet:
    async with write_tx(session):
        root = _change_set_root(payload.metadata)
        metadata = dict(payload.metadata or {})
        if root:
            metadata["root"] = root
        rows = (await session.scalars(select(FileEntryRow).where(
            FileEntryRow.user_id == payload.user_id, FileEntryRow.conversation_id == payload.conversation_id,
        ))).all()
        now = datetime.now(UTC)
        row = FileChangeSetRow(
            id=_id(), user_id=payload.user_id, org_id=payload.org_id, conversation_id=payload.conversation_id,
            status="open",
            baseline_sha256={item.path: item.sha256 for item in rows if _in_root(item.path, root)},
            metadata_json=metadata or None,
            created_at=now, updated_at=now,
        )
        session.add(row)
    return ChangeSet(id=row.id, status=row.status, conversation_id=row.conversation_id)


async def _change_set(session: DbSession, change_set_id: str, user_id: str, *, lock: bool = False) -> FileChangeSetRow:
    statement = select(FileChangeSetRow).where(FileChangeSetRow.id == change_set_id, FileChangeSetRow.user_id == user_id)
    if lock:
        statement = statement.with_for_update()
    row = await session.scalar(statement)
    if row is None:
        raise NotFoundError(f"file change set {change_set_id} not found")
    if row.status != "open":
        raise ConflictError(f"file change set {change_set_id} is {row.status}")
    return row


@router.put("/change-sets/{change_set_id}/files", response_model=FileEntry)
async def write_change_set_file(change_set_id: str, payload: WriteChangeSetFileInput, session: DbSession) -> FileEntry:
    path = _path(payload.path)
    if path.startswith("sources/"):
        raise RequestError("source files are read-only")
    async with write_tx(session):
        change_set = await _change_set(session, change_set_id, payload.user_id)
        root = _change_set_root(change_set.metadata_json)
        if not _in_root(path, root):
            raise RequestError(f"file {path} is outside change set root {root}")
        now = datetime.now(UTC)
        row = await session.scalar(select(FileChangeSetEntryRow).where(
            FileChangeSetEntryRow.change_set_id == change_set.id, FileChangeSetEntryRow.path == path,
        ))
        digest = sha256(payload.content.encode()).hexdigest()
        if row is None:
            row = FileChangeSetEntryRow(
                id=_id(), change_set_id=change_set.id, path=path, mime_type=payload.mime_type, content=payload.content,
                sha256=digest, writable=payload.writable, derived=payload.derived, deleted=False, created_at=now, updated_at=now,
            )
            session.add(row)
        else:
            row.mime_type, row.content, row.sha256 = payload.mime_type, payload.content, digest
            row.writable, row.derived, row.deleted, row.updated_at = payload.writable, payload.derived, False, now
        change_set.updated_at = now
    return FileEntry(path=row.path, mime_type=row.mime_type, size=len(row.content.encode()), sha256=row.sha256, writable=row.writable, derived=row.derived)


@router.get("/change-sets/{change_set_id}/files", response_model=list[FileEntry])
async def list_change_set_files(
    change_set_id: str,
    session: DbSession,
    user_id: str = Query(...),
) -> list[FileEntry]:
    change_set = await _change_set(session, change_set_id, user_id)
    rows = (await session.scalars(select(FileChangeSetEntryRow).where(
        FileChangeSetEntryRow.change_set_id == change_set.id,
        FileChangeSetEntryRow.deleted.is_(False),
    ).order_by(FileChangeSetEntryRow.path))).all()
    return [_entry(row) for row in rows]


@router.get("/change-sets/{change_set_id}/read", response_model=FileRead)
async def read_change_set_file(
    change_set_id: str,
    session: DbSession,
    user_id: str = Query(...),
    path: str = Query(...),
    offset: int = Query(default=1, ge=1),
    limit: int = Query(default=400, ge=1, le=400),
) -> FileRead:
    target = _path(path)
    change_set = await _change_set(session, change_set_id, user_id)
    row = await session.scalar(select(FileChangeSetEntryRow).where(
        FileChangeSetEntryRow.change_set_id == change_set.id, FileChangeSetEntryRow.path == target,
    ))
    if row is None:
        raise NotFoundError(f"staged file {target} not found")
    lines = row.content.split("\n")
    start = offset - 1
    return FileRead(path=row.path, mime_type=row.mime_type, size=len(row.content.encode()), sha256=row.sha256, writable=row.writable, derived=row.derived, offset=offset, total_lines=len(lines), next_offset=start + limit + 1 if start + limit < len(lines) else None, content="\n".join(lines[start : start + limit]))


@router.post("/change-sets/{change_set_id}/promote", response_model=list[FileEntry])
async def promote_change_set(change_set_id: str, payload: PromoteChangeSetInput, session: DbSession) -> list[FileEntry]:
    async with write_tx(session):
        change_set = await _change_set(session, change_set_id, payload.user_id, lock=True)
        root = _change_set_root(change_set.metadata_json)
        lock_key = f"{change_set.user_id}:{change_set.conversation_id}:{root or '*'}"
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
            {"lock_key": lock_key},
        )
        current_statement = select(FileEntryRow).where(
            FileEntryRow.user_id == change_set.user_id, FileEntryRow.conversation_id == change_set.conversation_id,
        )
        if root:
            current_statement = current_statement.where(
                FileEntryRow.path.startswith(root) if root.endswith("/") else FileEntryRow.path == root,
            )
        current_in_root = (await session.scalars(current_statement.with_for_update())).all()
        current_sha = {row.path: row.sha256 for row in current_in_root}
        if current_sha != change_set.baseline_sha256:
            raise ConflictError("file change set baseline is stale")
        staged = (await session.scalars(select(FileChangeSetEntryRow).where(
            FileChangeSetEntryRow.change_set_id == change_set.id,
        ))).all()
        by_path = {row.path: row for row in current_in_root}
        now = datetime.now(UTC)
        staged_paths = {entry.path for entry in staged if not entry.deleted}
        if change_set.metadata_json and change_set.metadata_json.get("replace_root") == "true":
            for obsolete in current_in_root:
                if obsolete.path not in staged_paths:
                    await session.delete(obsolete)
        for entry in staged:
            if entry.deleted:
                continue
            current_entry = by_path.get(entry.path)
            if current_entry is None:
                session.add(FileEntryRow(
                    id=_id(), user_id=change_set.user_id, org_id=change_set.org_id, conversation_id=change_set.conversation_id,
                    path=entry.path, mime_type=entry.mime_type, content=entry.content, sha256=entry.sha256,
                    writable=entry.writable, derived=entry.derived, created_at=now, updated_at=now,
                ))
            else:
                current_entry.mime_type, current_entry.content, current_entry.sha256 = entry.mime_type, entry.content, entry.sha256
                current_entry.writable, current_entry.derived, current_entry.updated_at = entry.writable, entry.derived, now
        change_set.status, change_set.updated_at = "promoted", now
    rows = (await session.scalars(select(FileEntryRow).where(
        FileEntryRow.user_id == change_set.user_id, FileEntryRow.conversation_id == change_set.conversation_id,
    ).order_by(FileEntryRow.path))).all()
    return [_entry(row) for row in rows]


@router.post("/change-sets/{change_set_id}/discard", response_model=ChangeSet)
async def discard_change_set(change_set_id: str, payload: PromoteChangeSetInput, session: DbSession) -> ChangeSet:
    async with write_tx(session):
        row = await _change_set(session, change_set_id, payload.user_id, lock=True)
        row.status, row.updated_at = "discarded", datetime.now(UTC)
    return ChangeSet(id=row.id, status=row.status, conversation_id=row.conversation_id)


@router.post("/search", response_model=list[FileSearchMatch])
async def search_files(payload: FileSearchInput, session: DbSession) -> list[FileSearchMatch]:
    try:
        expression = re.compile(payload.pattern, re.IGNORECASE)
    except re.error as error:
        raise RequestError(f"invalid search pattern: {error}") from error
    rows = (await session.scalars(select(FileEntryRow).where(
        FileEntryRow.user_id == payload.user_id, FileEntryRow.conversation_id == payload.conversation_id,
    ).order_by(FileEntryRow.path))).all()
    sources = (await session.scalars(select(DocumentRow).where(
        DocumentRow.user_id == payload.user_id,
        DocumentRow.conversation_id == payload.conversation_id,
        DocumentRow.kind == "source",
    ).order_by(DocumentRow.created_at, DocumentRow.id))).all()
    matches: list[FileSearchMatch] = []
    searchable = [(row.path, row.content) for row in rows]
    searchable.extend((_source_path(row), row.content_md) for row in sources if row.content_md)
    prefix = f"{_path(payload.path.rstrip('/'))}/" if payload.path else ""
    for path, content in searchable:
        if prefix and not path.startswith(prefix):
            continue
        if payload.glob and not fnmatch.fnmatch(path, payload.glob):
            continue
        for number, line in enumerate(content.split("\n"), start=1):
            found = expression.search(line)
            if not found:
                continue
            matches.append(FileSearchMatch(path=path, line=number, column=found.start() + 1, text=line[:400]))
            if len(matches) == 200:
                return matches
    return matches
