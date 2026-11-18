import assert from "node:assert/strict";
import test from "node:test";

import { bashInputSchema, commandResult, DEFAULT_BASH_TIMEOUT_MS, MAX_BASH_TIMEOUT_MS } from "./bash.js";

test("Bash uses a short default deadline and permits an explicit bounded extension", () => {
  assert.equal(bashInputSchema.parse({ command: "pwd" }).timeout_ms, DEFAULT_BASH_TIMEOUT_MS);
  assert.equal(
    bashInputSchema.parse({ command: "just test", timeout_ms: MAX_BASH_TIMEOUT_MS }).timeout_ms,
    MAX_BASH_TIMEOUT_MS,
  );
  assert.throws(
    () => bashInputSchema.parse({ command: "sleep forever", timeout_ms: MAX_BASH_TIMEOUT_MS + 1 }),
    /Too big|less than or equal/i,
  );
});

test("Bash timeout preserves partial output and exposes the primary causal error", () => {
  const outcome = commandResult({
    exitCode: 124,
    stdout: "partial evidence",
    stderr: "",
    timedOut: true,
    timeoutMs: DEFAULT_BASH_TIMEOUT_MS,
  });

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.error.code, "COMMAND_TIMEOUT");
  assert.equal(outcome.error.retryable, false);
  assert.equal(outcome.error.details?.timeout_ms, DEFAULT_BASH_TIMEOUT_MS);
  assert.equal(outcome.data.stdout, "partial evidence");
});
