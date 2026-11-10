import assert from "node:assert/strict";
import test from "node:test";

import { validateUIMessages, type UIMessage } from "ai";

import { finalizeCancelledParts } from "./cancellation.js";

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
