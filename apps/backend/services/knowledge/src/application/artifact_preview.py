"""Semantic text previews for immutable Asset-backed artifacts."""


def is_text_artifact(media_type: str) -> bool:
    mime = media_type.partition(";")[0].strip().lower()
    return mime.startswith("text/") or mime in {
        "application/json",
        "application/xml",
        "application/javascript",
        "image/svg+xml",
    }


def decode_artifact_preview(content: bytes, media_type: str) -> str:
    # The Asset revision is authoritative. Unknown encodings remain downloadable
    # rather than publishing replacement characters as if they were original text.
    if not is_text_artifact(media_type):
        return ""
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return ""
