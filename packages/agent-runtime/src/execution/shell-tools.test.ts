import assert from "node:assert/strict";
import test from "node:test";

import { CommandSessions } from "./command-sessions.js";
import { formatExecOutput } from "./shell-tools.js";

test("bounded output retains a UTF-8 tail, its original size and the exit status", async () => {
  const sessions = new CommandSessions();
  const result = await sessions.start({ tty: false, reviewInput: false, yieldMs: 250, tokens: 3 }, async (io) => {
    io.output("界".repeat(100) + "end");
    return { stdout: "", stderr: "", termination: { type: "exit", exitCode: 7 } };
  });
  assert.equal(result.output.exit_code, 7);
  assert.equal(result.output.original_token_count, 76);
  assert.match(result.output.output, /truncated output/);
  assert.match(result.output.output, /界end$/);
  assert.doesNotMatch(result.output.output, /�/);
  assert.match(formatExecOutput(result.output), /Process exited with code 7/);
});
