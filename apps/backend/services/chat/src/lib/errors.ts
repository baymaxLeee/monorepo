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

export class AgentRuntimeError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, 502, "agent_runtime_failed", details);
  }
}

export class ProviderNotConfiguredError extends AppError {
  constructor(message: string) {
    super(message, 412, "provider_not_configured");
  }
}

export class AdminUnavailableError extends AppError {
  constructor(message: string) {
    super(message, 502, "admin_unavailable");
  }
}

export class AgentRunCancelledError extends Error {
  readonly code = "agent_run_cancelled";

  constructor(message = "agent run cancelled") {
    super(message);
    this.name = "AgentRunCancelledError";
  }
}

export function isAgentRunCancelled(err: unknown): boolean {
  if (err instanceof AgentRunCancelledError) return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return err instanceof Error && /aborted|cancelled/i.test(err.message);
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
