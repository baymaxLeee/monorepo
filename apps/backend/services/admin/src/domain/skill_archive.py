"""Bounded, path-safe extraction of an Agent Skill ZIP package."""

from __future__ import annotations

import hashlib
import mimetypes
import stat
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from kernel.errors import RequestError

_INLINE_EXTENSIONS = {
    ".css", ".csv", ".html", ".ini", ".java", ".js", ".json", ".jsx", ".kt",
    ".md", ".py", ".rb", ".rs", ".sh", ".sql", ".swift", ".toml", ".ts",
    ".tsx", ".txt", ".xml", ".yaml", ".yml",
}
_MAX_INLINE_BYTES = 200_000
_MAX_COMPRESSION_RATIO = 100


@dataclass(frozen=True)
class ArchiveFile:
    path: str
    mime_type: str
    size_bytes: int
    sha256: str
    content: str | None
    extracted_path: Path | None


def extract_skill_archive(
    archive: Path, target: Path, *, max_files: int, max_member_bytes: int, max_expanded_bytes: int
) -> list[ArchiveFile]:
    try:
        package = zipfile.ZipFile(archive)
    except (OSError, zipfile.BadZipFile) as exc:
        raise RequestError("Asset revision is not a valid ZIP archive") from exc
    with package:
        entries = package.infolist()
        if len(entries) > max_files:
            raise RequestError(f"skill archive may contain at most {max_files} entries")
        members = [entry for entry in entries if not entry.is_dir() and not _ignorable(entry.filename)]
        if not members:
            raise RequestError("skill archive contains no files")
        normalized = [_safe_path(entry) for entry in members]
        normalized = _strip_common_root(normalized)
        if len(set(normalized)) != len(normalized):
            raise RequestError("skill archive contains duplicate paths")
        total = 0
        result: list[ArchiveFile] = []
        for entry, relative in zip(members, normalized, strict=True):
            total += entry.file_size
            if entry.flag_bits & 0x1:
                raise RequestError(f"encrypted ZIP member is not supported: {relative}")
            if stat.S_IFMT(entry.external_attr >> 16) == stat.S_IFLNK:
                raise RequestError(f"symbolic links are not supported: {relative}")
            if entry.file_size > max_member_bytes:
                raise RequestError(f"skill archive member exceeds byte limit: {relative}")
            if total > max_expanded_bytes:
                raise RequestError("skill archive exceeds expanded byte limit")
            if entry.file_size > 0 and entry.compress_size == 0:
                raise RequestError(f"invalid compressed size for ZIP member: {relative}")
            if entry.compress_size > 0 and entry.file_size / entry.compress_size > _MAX_COMPRESSION_RATIO:
                raise RequestError(f"skill archive member exceeds compression ratio limit: {relative}")
            mime_type = mimetypes.guess_type(relative)[0] or "application/octet-stream"
            destination = target.joinpath(*PurePosixPath(relative).parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            actual = 0
            with package.open(entry) as source, destination.open("xb") as output:
                while chunk := source.read(256 * 1024):
                    actual += len(chunk)
                    if actual > entry.file_size or actual > max_member_bytes:
                        raise RequestError(f"skill archive member size changed while extracting: {relative}")
                    digest.update(chunk)
                    output.write(chunk)
            if actual != entry.file_size:
                raise RequestError(f"skill archive member size mismatch: {relative}")
            content = _read_inline(destination, relative, mime_type)
            result.append(
                ArchiveFile(
                    path=relative, mime_type=mime_type, size_bytes=actual, sha256=digest.hexdigest(),
                    content=content, extracted_path=None if content is not None else destination,
                )
            )
        if "SKILL.md" not in {item.path for item in result}:
            raise RequestError("skill archive must contain a root SKILL.md")
        return result


def _safe_path(entry: zipfile.ZipInfo) -> str:
    raw = entry.filename.replace("\\", "/")
    path = PurePosixPath(raw)
    if raw.startswith("/") or any(part in {"", ".", ".."} for part in path.parts):
        raise RequestError(f"unsafe ZIP member path: {entry.filename}")
    return path.as_posix()


def _strip_common_root(paths: list[str]) -> list[str]:
    parts = [PurePosixPath(path).parts for path in paths]
    if parts and all(len(item) > 1 and item[0] == parts[0][0] for item in parts):
        return [PurePosixPath(*item[1:]).as_posix() for item in parts]
    return paths


def _ignorable(path: str) -> bool:
    normalized = path.replace("\\", "/")
    return normalized.startswith("__MACOSX/") or PurePosixPath(normalized).name == ".DS_Store"


def _read_inline(path: Path, relative: str, mime_type: str) -> str | None:
    if path.stat().st_size > _MAX_INLINE_BYTES:
        return None
    if not (mime_type.startswith("text/") or PurePosixPath(relative).suffix.lower() in _INLINE_EXTENSIONS):
        return None
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None
