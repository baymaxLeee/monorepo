from application.artifact_preview import decode_artifact_preview, is_text_artifact


def test_utf8_text_preview_preserves_content_and_binary_stays_opaque():
    content = "# 报告\n\n数据\n"
    assert decode_artifact_preview(content.encode(), "text/markdown; charset=utf-8") == content
    assert decode_artifact_preview(b"\xef\xbb\xbfhello", "text/plain") == "hello"
    assert decode_artifact_preview(b"\xff\xfe", "text/plain") == ""
    assert decode_artifact_preview(b"PK\x00\x01", "application/zip") == ""
    assert is_text_artifact("text/html")
