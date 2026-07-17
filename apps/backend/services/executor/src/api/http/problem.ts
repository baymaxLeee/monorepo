import { AppError } from "../../application/errors.js";

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
