import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { NotFoundError, RuntimeResponseError } from "../../application/errors.js";
import { errorResponse } from "./problem.js";

test("Chat maps application errors at the HTTP boundary", async () => {
  const missing = errorResponse(new NotFoundError("conversation not found"));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { code: "not_found", message: "conversation not found" });

  let validationError: unknown;
  try {
    z.string().parse(42);
  } catch (error) {
    validationError = error;
  }
  const invalid = errorResponse(validationError);
  assert.equal(invalid.status, 400);
  assert.equal(((await invalid.json()) as { code: string }).code, "invalid_request");
});

test("Chat preserves Runtime error status, headers and body", async () => {
  const response = errorResponse(
    new RuntimeResponseError(
      Response.json({ code: "runtime_busy", message: "try later" }, { status: 503, headers: { "Retry-After": "2" } }),
    ),
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "2");
  assert.deepEqual(await response.json(), { code: "runtime_busy", message: "try later" });
});
