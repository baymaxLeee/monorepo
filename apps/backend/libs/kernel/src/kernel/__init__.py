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

__all__ = [
    "BaseError",
    "ConflictError",
    "ForbiddenError",
    "NotFoundError",
    "RequestError",
    "UnauthorizedError",
    "register_exception_handlers",
]
