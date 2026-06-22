"""Helpers for bounding OpenAI-compatible model request size."""

from __future__ import annotations

from typing import Any

_TOKEN_LIMIT_KEYS = ("max_tokens", "max_completion_tokens")


def bounded_extra_body_and_max_tokens(
    extra_body: dict[str, Any],
    *,
    default_max_tokens: int,
) -> tuple[dict[str, Any], int]:
    """Strip provider token-limit aliases and return an explicit bounded cap."""

    cleaned = dict(extra_body)
    provider_caps: list[int] = []
    for key in _TOKEN_LIMIT_KEYS:
        value = _positive_int(cleaned.pop(key, None))
        if value is not None:
            provider_caps.append(value)
    configured_cap = min(provider_caps) if provider_caps else None
    if configured_cap is None:
        return cleaned, default_max_tokens
    return cleaned, min(default_max_tokens, configured_cap)


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.isdigit():
        parsed = int(value)
        return parsed if parsed > 0 else None
    return None
