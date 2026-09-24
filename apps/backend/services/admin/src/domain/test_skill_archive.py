from __future__ import annotations

import stat
import zipfile
from pathlib import Path

import pytest
from kernel.errors import RequestError

from domain.skill_archive import extract_skill_archive


def _write_archive(path: Path, entries: list[tuple[str, bytes]], *, directories: list[str] | None = None) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for directory in directories or []:
            archive.writestr(directory.rstrip("/") + "/", b"")
        for name, content in entries:
            archive.writestr(name, content)


def test_extract_skill_archive_routes_text_and_binary_storage(tmp_path: Path) -> None:
    archive = tmp_path / "skill.zip"
    target = tmp_path / "output"
    target.mkdir()
    _write_archive(
        archive,
        [
            ("sample/SKILL.md", b"# Example\n"),
            ("sample/references/guide.txt", b"hello"),
            ("sample/assets/icon.png", b"\x89PNG\r\n\x1a\n"),
        ],
    )

    result = extract_skill_archive(
        archive, target, max_files=10, max_member_bytes=1024, max_expanded_bytes=4096
    )

    by_path = {item.path: item for item in result}
    assert set(by_path) == {"SKILL.md", "references/guide.txt", "assets/icon.png"}
    assert by_path["SKILL.md"].content == "# Example\n"
    assert by_path["SKILL.md"].extracted_path is None
    assert by_path["assets/icon.png"].content is None
    assert by_path["assets/icon.png"].extracted_path is not None
    assert by_path["assets/icon.png"].extracted_path.read_bytes() == b"\x89PNG\r\n\x1a\n"


@pytest.mark.parametrize(
    ("entry_name", "message"),
    [
        ("../SKILL.md", "unsafe ZIP member path"),
        ("/SKILL.md", "unsafe ZIP member path"),
        ("dir/../../SKILL.md", "unsafe ZIP member path"),
    ],
)
def test_extract_skill_archive_rejects_unsafe_paths(tmp_path: Path, entry_name: str, message: str) -> None:
    archive = tmp_path / "skill.zip"
    target = tmp_path / "output"
    target.mkdir()
    _write_archive(archive, [(entry_name, b"unsafe")])

    with pytest.raises(RequestError, match=message):
        extract_skill_archive(
            archive, target, max_files=10, max_member_bytes=1024, max_expanded_bytes=4096
        )


def test_extract_skill_archive_rejects_symbolic_links(tmp_path: Path) -> None:
    archive = tmp_path / "skill.zip"
    target = tmp_path / "output"
    target.mkdir()
    link = zipfile.ZipInfo("link")
    link.create_system = 3
    link.external_attr = (stat.S_IFLNK | 0o777) << 16
    with zipfile.ZipFile(archive, "w") as package:
        package.writestr("SKILL.md", b"# Example\n")
        package.writestr(link, "SKILL.md")

    with pytest.raises(RequestError, match="symbolic links"):
        extract_skill_archive(
            archive, target, max_files=10, max_member_bytes=1024, max_expanded_bytes=4096
        )


def test_extract_skill_archive_counts_directory_entries_against_budget(tmp_path: Path) -> None:
    archive = tmp_path / "skill.zip"
    target = tmp_path / "output"
    target.mkdir()
    _write_archive(
        archive,
        [("SKILL.md", b"# Example\n")],
        directories=["one", "two", "three"],
    )

    with pytest.raises(RequestError, match="at most 2 entries"):
        extract_skill_archive(
            archive, target, max_files=2, max_member_bytes=1024, max_expanded_bytes=4096
        )


def test_extract_skill_archive_requires_root_manifest(tmp_path: Path) -> None:
    archive = tmp_path / "skill.zip"
    target = tmp_path / "output"
    target.mkdir()
    _write_archive(archive, [("README.md", b"missing manifest")])

    with pytest.raises(RequestError, match=r"root SKILL\.md"):
        extract_skill_archive(
            archive, target, max_files=10, max_member_bytes=1024, max_expanded_bytes=4096
        )
