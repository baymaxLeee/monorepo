import assert from "node:assert/strict";
import test from "node:test";

import { MAX_AGENT_STEPS, isTerminalToolIssue, terminationInstruction } from "./termination.js";

test("ordinary tool failures remain model-owned", () => {
  assert.equal(
    isTerminalToolIssue({ code: "COMMAND_FAILED", message: "bad arguments", retryable: false, source: "bash" }),
    false,
  );
  assert.equal(terminationInstruction(3, []), undefined);
});

test("a confirmed timeout ends the tool phase with causal evidence", () => {
  const instruction = terminationInstruction(1, [
    {
      toolName: "bash",
      issue: {
        code: "COMMAND_TIMEOUT",
        message: "Command timed out after 10000ms.",
        retryable: false,
        source: "bash",
      },
    },
  ]);

  assert.match(instruction ?? "", /ended active execution/i);
  assert.match(instruction ?? "", /bash: code=COMMAND_TIMEOUT/);
  assert.match(instruction ?? "", /Do not call more tools/);
  assert.match(instruction ?? "", /root cause/i);
});

test("the hard step cap only reserves the final answer", () => {
  assert.equal(MAX_AGENT_STEPS, 50);
  assert.equal(terminationInstruction(MAX_AGENT_STEPS - 2, []), undefined);
  assert.match(terminationInstruction(MAX_AGENT_STEPS - 1, []) ?? "", /final response step/i);
});
