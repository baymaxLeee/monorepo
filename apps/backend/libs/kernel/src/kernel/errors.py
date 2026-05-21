"""Unified error types and handlers.

Services should NEVER raise raw HTTPException. Always use these.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class BaseError(Exception):
    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str = "", *, details: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.message = message or self.code
        self.details = details or {}


class RequestError(BaseError):
    status_code = 400
    code = "bad_request"


class UnauthorizedError(BaseError):
    status_code = 401
    code = "unauthorized"


class ForbiddenError(BaseError):
    status_code = 403
    code = "forbidden"


class NotFoundError(BaseError):
    status_code = 404
    code = "not_found"


class ConflictError(BaseError):
    status_code = 409
    code = "conflict"


def register_exception_handlers(app: FastAPI) -> None:
    """Wire BaseError → JSON response."""

    @app.exception_handler(BaseError)
    async def _handle(_: Request, exc: BaseError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            },
        )
