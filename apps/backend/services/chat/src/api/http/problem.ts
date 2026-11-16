import { ZodError } from "zod";

import { RuntimeResponseError } from "../../application/errors.js";

export function errorResponse(error: unknown): Response {
  if (error instanceof RuntimeResponseError) {
    return new Response(error.response.body, {
      status: error.response.status,
      headers: error.response.headers,
    });
  }
  if (error instanceof ZodError) {
    return Response.json(
      { code: "invalid_request", message: "request validation failed", issues: error.issues },
      { status: 400 },
    );
  }
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return Response.json({ code: error.code, message: error.message }, { status: error.status });
  }
  return Response.json({ code: "internal_error", message: "internal server error" }, { status: 500 });
}
