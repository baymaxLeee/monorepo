import assert from "node:assert/strict";
import test from "node:test";

import { normalizeToolIssue } from "./outcome.js";

test("a missing run sandbox is a terminal capability failure", () => {
  const error = Object.assign(new Error("runtime-sandbox snapshot failed: 422"), {
    service: "runtime-sandbox",
    status: 422,
    body: { message: "error: no such object: sandbox-run" },
  });

  assert.deepEqual(normalizeToolIssue(error), {
    code: "SANDBOX_UNAVAILABLE",
    message: "error: no such object: sandbox-run",
    retryable: false,
    source: "runtime-sandbox",
    details: { status_code: 422, body: { message: "error: no such object: sandbox-run" } },
  });
});
