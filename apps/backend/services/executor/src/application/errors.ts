export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, 404, "not_found", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(message, 401, "unauthorized");
  }
}

export class RequestError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, 400, "bad_request", details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "conflict", details: Record<string, unknown> = {}) {
    super(message, 409, code, details);
  }
}
