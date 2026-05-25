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
from .tracing import TraceIDMiddleware, get_trace_id

__all__ = [
    "BaseError",
    "ConflictError",
    "ForbiddenError",
    "NotFoundError",
    "RequestError",
    "TraceIDMiddleware",
    "UnauthorizedError",
    "get_trace_id",
    "register_exception_handlers",
]
