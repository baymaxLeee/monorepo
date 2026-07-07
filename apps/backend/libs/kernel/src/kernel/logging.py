"""Structured JSON logging, unified across the backend.

Emits the line format defined in ``schemas/observability/logging.md``:
``time`` (RFC3339 ms UTC), lowercase ``level``, ``msg``, ``service`` and — when a
request propagated one — ``trace_id``. structlog renders both structlog and
stdlib records (including uvicorn's) through a single JSON formatter so every
line on stdout is uniform.
"""

import logging
import os
import sys
import time
from datetime import UTC, datetime
from typing import cast

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send
from structlog.typing import EventDict, Processor, WrappedLogger

from .tracing import context_log_fields

# structlog/stdlib emit a level name per language; the contract enumerates only
# debug|info|warn|error, so collapse the Python-only spellings onto it.
_LEVEL_ALIASES = {
    "warning": "warn",
    "critical": "error",
    "fatal": "error",
    "exception": "error",
}

# Liveness/readiness probes fire constantly and carry no request context; logging
# them would drown real traffic.
_SKIP_PATHS = frozenset({"/livez", "/readyz", "/healthz"})


def _parse_log_level(raw: str | None) -> int:
    match (raw or "").strip().lower():
        case "debug":
            return logging.DEBUG
        case "warn" | "warning":
            return logging.WARNING
        case "error":
            return logging.ERROR
        case _:
            return logging.INFO


def _normalize_level(_logger: WrappedLogger, _method_name: str, event_dict: EventDict) -> EventDict:
    level = event_dict.get("level")
    if isinstance(level, str):
        event_dict["level"] = _LEVEL_ALIASES.get(level, level)
    return event_dict


def _add_context(_logger: WrappedLogger, _method_name: str, event_dict: EventDict) -> EventDict:
    # Inject propagated correlation fields (trace_id, user_id, ...); a value the
    # call site set explicitly wins, so business semantics are never clobbered.
    for key, value in context_log_fields().items():
        event_dict.setdefault(key, value)
    return event_dict


def _add_timestamp(_logger: WrappedLogger, _method_name: str, event_dict: EventDict) -> EventDict:
    # Contract mandates millisecond precision with a trailing Z; structlog's iso
    # TimeStamper emits microseconds and +00:00, which would diverge from the
    # pino/slog lines, so format explicitly (schemas/observability/logging.md).
    event_dict["time"] = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return event_dict


def _make_add_service(service: str) -> Processor:
    def processor(_logger: WrappedLogger, _method_name: str, event_dict: EventDict) -> EventDict:
        event_dict["service"] = service
        return event_dict

    return processor


def configure_logging(service: str) -> None:
    """Route all logging (structlog + stdlib + uvicorn) to one JSON stdout stream.

    Idempotent; call once at process start (import time is fine). Must run after
    uvicorn installs its own logging config, i.e. from inside the imported app
    module — which is why services call it from ``create_app``.
    """
    shared_processors: list[Processor] = [
        structlog.stdlib.add_log_level,
        _normalize_level,
        _make_add_service(service),
        _add_context,
        _add_timestamp,
    ]

    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.EventRenamer("msg"),
            structlog.processors.JSONRenderer(),
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(_parse_log_level(os.getenv("LOG_LEVEL")))

    # uvicorn configures these on boot; drop their handlers and let records
    # bubble to root so they render as the same JSON. Access logs are disabled
    # at the CLI (``--no-access-log``) since RequestLoggingMiddleware emits an
    # equivalent line that also carries trace_id.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return cast(structlog.stdlib.BoundLogger, structlog.get_logger(name))


class RequestLoggingMiddleware:
    """Emit one access-log line per request, inside the trace-id contextvar.

    Must sit *inside* ``TraceIDMiddleware`` (added after it, so it is the inner
    layer) — uvicorn's own access log fires after the contextvar is reset and so
    cannot carry ``trace_id``; this one runs while it is still set.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._logger = get_logger("http")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path", "") in _SKIP_PATHS:
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = int(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            self._logger.info(
                "http",
                method=scope.get("method"),
                path=scope.get("path"),
                status=status,
                duration_ms=round((time.perf_counter() - start) * 1000),
            )
