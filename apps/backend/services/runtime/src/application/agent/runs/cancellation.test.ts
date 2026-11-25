import assert from "node:assert/strict";
import test from "node:test";

import { validateUIMessages, type UIMessage } from "ai";

import { finalizeCancelledParts, finalizeTerminalParts } from "./cancellation.js";

for (const state of ["approval-requested", "approval-responded"] as const) {
  test(`cancelled ${state} remains a valid native message on hydration and replay`, async () => {
    const original: UIMessage = {
      id: "assistant",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "write",
          toolCallId: "call",
          input: {},
          state,
          approval: { id: "approval", ...(state === "approval-responded" ? { approved: false } : {}) },
        } as UIMessage["parts"][number],
      ],
    };
    const parts = finalizeCancelledParts(original.parts);
    const validated = await validateUIMessages({ messages: [{ ...original, parts }] });
    assert.equal((validated[0]!.parts[0] as { state: string }).state, "output-error");
    assert.equal((original.parts[0] as { state: string }).state, state);
  });
}

test("failed approved tool calls preserve the approval fact and gain a terminal result", async () => {
  const original: UIMessage = {
    id: "assistant",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "Bash",
        toolCallId: "call",
        input: { command: "echo hello" },
        state: "approval-responded",
        approval: { id: "approval", approved: true },
      } as UIMessage["parts"][number],
    ],
  };

  const parts = finalizeTerminalParts(original.parts, "failed");
  const validated = await validateUIMessages({ messages: [{ ...original, parts }] });
  const terminal = validated[0]!.parts[0] as { state: string; approval?: { approved?: boolean }; errorText?: string };
  assert.equal(terminal.state, "output-error");
  assert.equal(terminal.approval?.approved, true);
  assert.match(terminal.errorText ?? "", /失败/);
});
