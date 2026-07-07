"""Shared kernel package: errors, context, logging."""

from .errors import (
    BaseError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    RequestError,
    UnauthorizedError,
    register_exception_handlers,
)
from .logging import RequestLoggingMiddleware, configure_logging, get_logger
from .tracing import TraceIDMiddleware, get_trace_id

__all__ = [
    "BaseError",
    "ConflictError",
    "ForbiddenError",
    "NotFoundError",
    "RequestError",
    "RequestLoggingMiddleware",
    "TraceIDMiddleware",
    "UnauthorizedError",
    "configure_logging",
    "get_logger",
    "get_trace_id",
    "register_exception_handlers",
]
