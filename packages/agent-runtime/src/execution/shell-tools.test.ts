import assert from "node:assert/strict";
import test from "node:test";

import { CommandSessions } from "./command-sessions.js";
import { bashArgs, commandForPolicy, formatExecOutput } from "./shell-tools.js";

test("Bash approval fields are rejected by the input schema before admission", () => {
  for (const input of [
    {
      command: "curl https://example.com",
      sandbox_permissions: "with_additional_permissions",
      additional_permissions: { network: { enabled: true } },
      justification: "Fetch the resource.",
    },
    {
      command: "curl https://example.com",
      sandbox_permissions: "use_default",
      additional_permissions: { network: { enabled: true } },
    },
    {
      command: "curl https://example.com",
      sandbox_permissions: "require_escalated",
      additional_permissions: { network: { enabled: true } },
    },
  ]) {
    const parsed = bashArgs.safeParse(input);
    assert.equal(parsed.success, false);
  }

  assert.doesNotThrow(() =>
    commandForPolicy(
      bashArgs.parse({
        command: "curl https://example.com",
        sandbox_permissions: "require_escalated",
        justification: "Fetch the resource.",
        prefix_rule: ["curl"],
      }),
    ),
  );
});

test("bounded output retains a UTF-8 tail, its original size and the exit status", async () => {
  const sessions = new CommandSessions();
  const result = await sessions.start({ tty: false, reviewInput: false, yieldMs: 250, tokens: 3 }, async (io) => {
    io.retainOutput({ path: "/host-private/complete.log" });
    io.output("界".repeat(100) + "end");
    return { stdout: "", stderr: "", termination: { type: "exit", exitCode: 7 } };
  });
  assert.equal(result.output.exit_code, 7);
  assert.equal(result.output.original_token_count, 76);
  assert.match(result.output.output, /truncated output/);
  assert.match(result.output.output, /界end$/);
  assert.doesNotMatch(result.output.output, /�/);
  assert.match(formatExecOutput(result.output), /Process exited with code 7/);
  assert.match(
    formatExecOutput(result.output),
    /\[Full output: \/host-private\/complete\.log \(read it with Bash using byte offsets\/limits\)\]$/,
  );
});
