"""Trace-id propagation helpers for ASGI services."""

from contextvars import ContextVar
from typing import cast

from starlette.types import ASGIApp, Message, Receive, Scope, Send

TRACE_HEADER = "x-trace-id"
_trace_id: ContextVar[str] = ContextVar("trace_id", default="")


def get_trace_id() -> str:
    """Return the current request trace id, if one was propagated."""
    return _trace_id.get()


class TraceIDMiddleware:
    """Store X-Trace-Id in a contextvar and mirror it on responses."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        trace_id = _header(scope, TRACE_HEADER)
        token = _trace_id.set(trace_id)

        async def send_with_trace(message: Message) -> None:
            if message["type"] == "http.response.start" and trace_id:
                headers = list(message.get("headers", []))
                headers.append((b"x-trace-id", trace_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_trace)
        finally:
            _trace_id.reset(token)


def _header(scope: Scope, name: str) -> str:
    raw_name = name.encode()
    for key, value in scope.get("headers", []):
        if key == raw_name:
            return cast(bytes, value).decode(errors="ignore")
    return ""
