import assert from "node:assert/strict";
import test from "node:test";

import { terminalStreamError } from "./stream-outcome.js";

test("a completed stream is not poisoned by an earlier non-terminal error part", () => {
  assert.equal(terminalStreamError({ status: "completed" }, "stop"), null);
});

test("a terminal failed outcome preserves its error", () => {
  const error = new Error("provider stream failed");

  assert.equal(terminalStreamError({ status: "failed", error }, "error"), error);
});

test("an error finish reason fails even when the stream outcome has no error", () => {
  assert.equal(terminalStreamError({ status: "completed" }, "error"), "model stream ended with an error");
});

test("an aborted stream is handled by cancellation rather than failure", () => {
  assert.equal(terminalStreamError({ status: "aborted" }, undefined), null);
});
