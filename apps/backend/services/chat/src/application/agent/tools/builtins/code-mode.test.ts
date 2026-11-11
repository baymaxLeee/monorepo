import assert from "node:assert/strict";
import test from "node:test";

import { CodeModeDetachedBridgeRequestError, CodeModeTimeoutError } from "@ai-sdk/code-mode";

import { CODE_MODE_TIMEOUT_MS, codeModeFailure } from "./code-mode.js";

function issue(error: unknown) {
  assert.ok(error && typeof error === "object");
  return error as { code?: string; message?: string; retryable?: boolean; source?: string };
}

void test("Code Mode wall time contains sequential search and fetch phases", () => {
  assert.equal(CODE_MODE_TIMEOUT_MS, 90_000);
});

void test("Code Mode timeout and detached-call failures provide corrective actions", () => {
  const timeout = issue(codeModeFailure(new CodeModeTimeoutError(CODE_MODE_TIMEOUT_MS)));
  assert.equal(timeout.code, "CODE_MODE_TIMEOUT");
  assert.equal(timeout.source, "code-mode");
  assert.equal(timeout.retryable, false);
  assert.match(timeout.message ?? "", /Promise\.all/);
  assert.match(timeout.message ?? "", /split discovery and document reading/i);

  const detached = issue(new CodeModeDetachedBridgeRequestError("Detached request", {}));
  const guidedDetached = issue(codeModeFailure(detached));
  assert.equal(guidedDetached.code, "CODE_MODE_DETACHED_BRIDGE_REQUEST");
  assert.match(guidedDetached.message ?? "", /Await every tool call/i);
});
