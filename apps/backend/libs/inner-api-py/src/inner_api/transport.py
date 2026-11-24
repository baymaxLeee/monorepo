"""Shared Python gRPC caller identity, deadline, and metadata policy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict


class CallOptions(TypedDict):
    metadata: list[tuple[str, str]]
    timeout: float


_RESERVED = frozenset({"x-caller-service", "x-internal-token"})


@dataclass(frozen=True)
class InnerApiCaller:
    service: str
    token: str
    default_timeout: float = 10.0

    def __post_init__(self) -> None:
        if not self.service:
            raise ValueError("inner API caller service is required")
        if not self.token:
            raise ValueError("inner API caller credential is required")
        if self.default_timeout <= 0:
            raise ValueError("inner API deadline must be positive")

    def options(self, headers: dict[str, str] | None = None, timeout: float | None = None) -> CallOptions:
        deadline = self.default_timeout if timeout is None else timeout
        if deadline <= 0:
            raise ValueError("inner API deadline must be positive")
        metadata: list[tuple[str, str]] = []
        for key, value in (headers or {}).items():
            normalized = key.lower()
            if normalized in _RESERVED or normalized.startswith("grpc-"):
                raise ValueError(f"inner API metadata {key} is transport-owned")
            metadata.append((normalized, value))
        metadata.extend((("x-caller-service", self.service), ("x-internal-token", self.token)))
        return {"metadata": metadata, "timeout": deadline}
