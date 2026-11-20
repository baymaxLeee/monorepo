import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  bashInputSchema,
  commandResult,
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_OUTPUT_BYTES,
  MAX_BASH_OUTPUT_LINES,
  MAX_BASH_TIMEOUT_MS,
  truncateBashStream,
} from "./bash.js";
import { isToolOutcome, outcomeFromEmission, toolOutcomeSchema } from "./outcome.js";

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

test("Bash keeps long stderr in result data without invalidating the ToolOutcome error", () => {
  const stderr = "failure detail\n".repeat(250);
  const outcome = outcomeFromEmission(
    commandResult({
      stdout: "",
      stderr,
      termination: { type: "exit", exitCode: 17 },
    }),
  );

  assert.ok(isToolOutcome(outcome));
  assert.equal(toolOutcomeSchema(z.unknown()).safeParse(outcome).success, true);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.data.stderr, stderr);
  assert.equal(outcome.error.details?.exit_code, 17);
  assert.ok(outcome.error.message.length <= 2_000);
  assert.doesNotMatch(outcome.error.message, /failure detail/u);
});

test("Bash reports unknown original line counts when the transport retained only an output tail", () => {
  const outcome = commandResult({
    stdout: "retained tail\n",
    stderr: "",
    outputMetadata: {
      stdout: { totalBytes: 100_000, truncated: true },
      stderr: { totalBytes: 0, truncated: false },
    },
    termination: { type: "exit", exitCode: 0 },
  } as Parameters<typeof commandResult>[0] & {
    outputMetadata: {
      stdout: { totalBytes: number; truncated: boolean };
      stderr: { totalBytes: number; truncated: boolean };
    };
  });

  assert.equal(outcome.status, "completed");
  assert.match(outcome.data.stdout, /transport retained only a tail/u);
  assert.deepEqual(outcome.data.truncation?.stdout, {
    truncatedBy: "transport",
    totalLines: null,
    totalBytes: 100_000,
    outputLines: 1,
    outputBytes: Buffer.byteLength("retained tail\n"),
    omittedLines: null,
    omittedBytes: 100_000 - Buffer.byteLength("retained tail\n"),
    partialFirstLine: null,
    transportTruncated: true,
  });
});
