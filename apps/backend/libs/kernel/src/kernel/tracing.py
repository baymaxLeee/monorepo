"""Correlation-context propagation helpers for ASGI services.

A request carries a small set of low-cardinality correlation identifiers
(trace_id + identity) that are injected into every log line and forwarded on
outbound internal calls. The registry below is the single source of truth —
adding a field is one row here (plus a gateway injection point for trusted
identity fields). Mirrors ``libs/kernel-ts/src/trace.ts`` and the contract in
``schemas/observability/logging.md``.
"""

import re
import secrets
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import cast

from opentelemetry import propagate, trace
from opentelemetry.trace import SpanKind, Status, StatusCode
from starlette.types import ASGIApp, Message, Receive, Scope, Send

TRACE_HEADER = "x-trace-id"
TRACEPARENT_HEADER = "traceparent"
_TRACE_ID_LENGTH = 32
_TRACEPARENT_RE = re.compile(r"^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$")


@dataclass(frozen=True)
class PropagatedField:
    header: str  # lowercase wire header (ASGI header keys are lowercase)
    log_key: str
    var: ContextVar[str]


PROPAGATED_FIELDS: tuple[PropagatedField, ...] = (
    PropagatedField("x-trace-id", "trace_id", ContextVar("trace_id", default="")),
    PropagatedField("traceparent", "traceparent", ContextVar("traceparent", default="")),
    PropagatedField("x-auth-user-id", "user_id", ContextVar("user_id", default="")),
    PropagatedField("x-workspace-id", "workspace_id", ContextVar("workspace_id", default="")),
    PropagatedField("x-tenant-id", "tenant_id", ContextVar("tenant_id", default="")),
)

_TRACE_FIELD = PROPAGATED_FIELDS[0]
_TRACEPARENT_FIELD = PROPAGATED_FIELDS[1]


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

        carrier = _carrier(scope)
        incoming_traceparent = _normalize_traceparent(carrier.get(TRACEPARENT_HEADER, ""))
        trace_id = _trace_id_from_traceparent(incoming_traceparent) or _field_value(scope, _TRACE_FIELD)
        if not trace_id:
            trace_id = secrets.token_hex(16)
        fallback_traceparent = incoming_traceparent or _new_traceparent(trace_id)
        carrier[TRACE_HEADER] = trace_id
        carrier[TRACEPARENT_HEADER] = fallback_traceparent

        parent_context = propagate.extract(carrier)
        tracer = trace.get_tracer("backend-http")

        with tracer.start_as_current_span(
            f"{scope.get('method', 'HTTP')} {scope.get('path', '/')}",
            context=parent_context,
            kind=SpanKind.SERVER,
            attributes={
                "http.request.method": scope.get("method", ""),
                "url.path": scope.get("path", ""),
            },
        ) as span:
            active_traceparent = _traceparent_from_span(fallback_traceparent)
            active_trace_id = _trace_id_from_traceparent(active_traceparent) or trace_id
            tokens: list[tuple[ContextVar[str], Token[str]]] = []
            for field in PROPAGATED_FIELDS:
                value = _field_value(scope, field)
                if field is _TRACE_FIELD:
                    value = active_trace_id
                elif field is _TRACEPARENT_FIELD:
                    value = active_traceparent
                tokens.append((field.var, field.var.set(value)))

            async def send_with_trace(message: Message) -> None:
                if message["type"] == "http.response.start":
                    headers = list(message.get("headers", []))
                    headers.append((b"x-trace-id", active_trace_id.encode()))
                    headers.append((b"traceparent", active_traceparent.encode()))
                    message["headers"] = headers
                    if status := message.get("status"):
                        span.set_attribute("http.response.status_code", int(status))
                        if int(status) >= 500:
                            span.set_status(Status(StatusCode.ERROR))
                await send(message)

            try:
                await self.app(scope, receive, send_with_trace)
            except Exception as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR))
                raise
            finally:
                for var, token in tokens:
                    var.reset(token)


def _header(scope: Scope, name: str) -> str:
    raw_name = name.encode()
    for key, value in scope.get("headers", []):
        if key == raw_name:
            return cast(bytes, value).decode(errors="ignore").strip()
    return ""


def _carrier(scope: Scope) -> dict[str, str]:
    return {
        cast(bytes, key).decode(errors="ignore").lower(): cast(bytes, value).decode(errors="ignore").strip()
        for key, value in scope.get("headers", [])
    }


def _field_value(scope: Scope, field: PropagatedField) -> str:
    value = _header(scope, field.header)
    if field is _TRACEPARENT_FIELD:
        return _normalize_traceparent(value)
    if field is not _TRACE_FIELD:
        return value
    normalized = value.lower()
    if len(normalized) != _TRACE_ID_LENGTH:
        return ""
    return normalized if all(char in "0123456789abcdef" for char in normalized) else ""


def _normalize_traceparent(value: str) -> str:
    normalized = value.strip().lower()
    return normalized if _TRACEPARENT_RE.match(normalized) else ""


def _trace_id_from_traceparent(value: str) -> str:
    normalized = _normalize_traceparent(value)
    if not normalized:
        return ""
    return normalized.split("-")[1]


def _new_traceparent(trace_id: str) -> str:
    return f"00-{trace_id}-{secrets.token_hex(8)}-01"


def _traceparent_from_span(fallback: str) -> str:
    span_context = trace.get_current_span().get_span_context()
    if not span_context.is_valid:
        return fallback
    flags = f"{int(span_context.trace_flags):02x}"
    return f"00-{span_context.trace_id:032x}-{span_context.span_id:016x}-{flags}"
