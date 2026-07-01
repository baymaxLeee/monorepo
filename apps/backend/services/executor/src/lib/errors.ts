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

export function problemJson(err: unknown): { body: object; status: number } {
  if (err instanceof AppError) {
    return {
      status: err.statusCode,
      body: { code: err.code, message: err.message, details: err.details },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { code: "internal_error", message } };
}
