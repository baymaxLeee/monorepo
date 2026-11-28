from types import SimpleNamespace
from typing import Any

import pytest

from application import convert


@pytest.mark.asyncio
async def test_non_image_files_still_flow_through_markitdown(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, Any] = {}

    class FakeMarkItDown:
        def __init__(self, **kwargs: Any) -> None:
            calls["init"] = kwargs

        def convert_stream(self, stream: Any, *, stream_info: Any) -> Any:
            calls["content"] = stream.read()
            calls["filename"] = stream_info.filename
            calls["mimetype"] = stream_info.mimetype
            return SimpleNamespace(text_content="# Converted\n\nhello")

    monkeypatch.setattr(convert, "MarkItDown", FakeMarkItDown)

    markdown = await convert.ConvertService().convert(
        filename="handbook.docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content=b"office bytes",
    )

    assert markdown == "# Converted\n\nhello"
    assert calls == {
        "init": {"enable_plugins": False},
        "content": b"office bytes",
        "filename": "handbook.docx",
        "mimetype": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }


@pytest.mark.asyncio
async def test_long_converted_documents_are_not_truncated_at_the_old_12k_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = convert.ConvertService()
    converted = "# Long document\n\n" + ("knowledge " * 2000)
    monkeypatch.setattr(service, "_convert_sync", lambda *_args: converted)

    markdown = await service.convert(filename="long.html", mime_type="text/html", content=b"source")

    assert markdown == converted.strip()
    assert len(markdown) > 12_000
