import assert from "node:assert/strict";
import test from "node:test";

import {
  bashInputSchema,
  commandResult,
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_OUTPUT_BYTES,
  MAX_BASH_OUTPUT_LINES,
  MAX_BASH_TIMEOUT_MS,
  truncateBashStream,
} from "./bash.js";

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
    stdout: "partial evidence",
    stderr: "",
    termination: { type: "timeout", timeoutMs: DEFAULT_BASH_TIMEOUT_MS },
  });

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.error.code, "COMMAND_TIMEOUT");
  assert.equal(outcome.error.retryable, false);
  assert.equal(outcome.error.details?.timeout_ms, DEFAULT_BASH_TIMEOUT_MS);
  assert.equal(outcome.data.stdout, "partial evidence");
});

test("Bash keeps the actionable output tail and reports line omissions", () => {
  const stdout = `${Array.from({ length: MAX_BASH_OUTPUT_LINES + 5 }, (_, index) => `line ${index + 1}`).join("\n")}\n`;
  const outcome = commandResult({
    stdout,
    stderr: "",
    termination: { type: "exit", exitCode: 0 },
  });

  assert.equal(outcome.status, "completed");
  assert.doesNotMatch(outcome.data.stdout, /line 1\n/u);
  assert.match(outcome.data.stdout, new RegExp(`line ${MAX_BASH_OUTPUT_LINES + 5}$`, "u"));
  assert.match(outcome.data.stdout, /Earlier stdout output truncated/u);
  assert.deepEqual(outcome.data.truncation?.stdout, {
    truncatedBy: "lines",
    totalLines: MAX_BASH_OUTPUT_LINES + 5,
    totalBytes: Buffer.byteLength(stdout),
    outputLines: MAX_BASH_OUTPUT_LINES,
    outputBytes: Buffer.byteLength(
      Array.from({ length: MAX_BASH_OUTPUT_LINES }, (_, index) => `line ${index + 6}`).join("\n"),
    ),
    omittedLines: 5,
    omittedBytes:
      Buffer.byteLength(stdout) -
      Buffer.byteLength(Array.from({ length: MAX_BASH_OUTPUT_LINES }, (_, index) => `line ${index + 6}`).join("\n")),
    partialFirstLine: false,
  });
});

test("Bash byte truncation preserves valid UTF-8 from the end of one oversized line", () => {
  const result = truncateBashStream(`prefix-${"界".repeat(MAX_BASH_OUTPUT_BYTES)}-final`, "stderr");

  assert.ok(result.truncation);
  assert.equal(result.truncation.truncatedBy, "bytes");
  assert.equal(result.truncation.partialFirstLine, true);
  assert.match(result.content, /-final$/u);
  assert.doesNotMatch(result.content, /�/u);
  assert.ok(result.truncation.outputBytes <= MAX_BASH_OUTPUT_BYTES);
});
