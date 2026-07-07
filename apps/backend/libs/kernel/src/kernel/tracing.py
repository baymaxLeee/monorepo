"""Correlation-context propagation helpers for ASGI services.

A request carries a small set of low-cardinality correlation identifiers
(trace_id + identity) that are injected into every log line and forwarded on
outbound internal calls. The registry below is the single source of truth —
adding a field is one row here (plus a gateway injection point for trusted
identity fields). Mirrors ``libs/kernel-ts/src/trace.ts`` and the contract in
``schemas/observability/logging.md``.
"""

from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import cast

from starlette.types import ASGIApp, Message, Receive, Scope, Send

TRACE_HEADER = "x-trace-id"
_TRACE_ID_LENGTH = 32


@dataclass(frozen=True)
class PropagatedField:
    header: str  # lowercase wire header (ASGI header keys are lowercase)
    log_key: str
    var: ContextVar[str]


PROPAGATED_FIELDS: tuple[PropagatedField, ...] = (
    PropagatedField("x-trace-id", "trace_id", ContextVar("trace_id", default="")),
    PropagatedField("x-auth-user-id", "user_id", ContextVar("user_id", default="")),
    PropagatedField("x-workspace-id", "workspace_id", ContextVar("workspace_id", default="")),
    PropagatedField("x-tenant-id", "tenant_id", ContextVar("tenant_id", default="")),
)

_TRACE_FIELD = PROPAGATED_FIELDS[0]


def get_trace_id() -> str:
    """Return the current request trace id, if one was propagated."""
    return _TRACE_FIELD.var.get()


def context_log_fields() -> dict[str, str]:
    """Non-empty correlation fields for the current request, keyed by log name."""
    return {field.log_key: value for field in PROPAGATED_FIELDS if (value := field.var.get())}


def propagation_headers() -> dict[str, str]:
    """Headers to forward on an outbound internal call, from the current context."""
    return {field.header: value for field in PROPAGATED_FIELDS if (value := field.var.get())}


class TraceIDMiddleware:
    """Bind propagated correlation headers to contextvars; mirror trace id on responses.

    Generation/normalisation of trace ids happens only at the edge (gateway);
    downstream services just read whatever was propagated.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        tokens: list[tuple[ContextVar[str], Token[str]]] = []
        trace_id = ""
        for field in PROPAGATED_FIELDS:
            value = _field_value(scope, field)
            tokens.append((field.var, field.var.set(value)))
            if field is _TRACE_FIELD:
                trace_id = value

        async def send_with_trace(message: Message) -> None:
            if message["type"] == "http.response.start" and trace_id:
                headers = list(message.get("headers", []))
                headers.append((b"x-trace-id", trace_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_trace)
        finally:
            for var, token in tokens:
                var.reset(token)


def _header(scope: Scope, name: str) -> str:
    raw_name = name.encode()
    for key, value in scope.get("headers", []):
        if key == raw_name:
            return cast(bytes, value).decode(errors="ignore").strip()
    return ""


def _field_value(scope: Scope, field: PropagatedField) -> str:
    value = _header(scope, field.header)
    if field is not _TRACE_FIELD:
        return value
    normalized = value.lower()
    if len(normalized) != _TRACE_ID_LENGTH:
        return ""
    return normalized if all(char in "0123456789abcdef" for char in normalized) else ""
