import assert from "node:assert/strict";
import test from "node:test";

import type { UIMessage } from "ai";

import { applyToolApprovalResponse, finalizeInterruptedMessages, hasPendingToolApprovals } from "./lifecycle.js";

function approvalMessage(): UIMessage {
  return {
    id: "assistant",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "call-1",
        state: "approval-requested",
        input: { command: "touch result.txt" },
        approval: { id: "approval-1" },
      },
    ],
  } as UIMessage;
}

test("approval response performs one native transition without rewriting tool identity", () => {
  const original = approvalMessage();
  const updated = applyToolApprovalResponse([original], { approvalId: "approval-1", approved: true });

  assert.equal(hasPendingToolApprovals(updated), false);
  assert.deepEqual(updated[0]?.parts[0], {
    ...original.parts[0],
    state: "approval-responded",
    approval: { id: "approval-1", approved: true },
  });
  assert.equal((original.parts[0] as { state?: string } | undefined)?.state, "approval-requested");
});

test("approval response rejects stale and duplicate identities", () => {
  const message = approvalMessage();
  assert.throws(
    () => applyToolApprovalResponse([message], { approvalId: "missing", approved: true }),
    /不存在或已处理/,
  );
  assert.throws(
    () =>
      applyToolApprovalResponse([{ ...message, parts: [...message.parts, structuredClone(message.parts[0]!)] }], {
        approvalId: "approval-1",
        approved: false,
      }),
    /重复/,
  );
});

test("interruption preserves completed tools and terminalizes unfinished native parts", () => {
  const messages = finalizeInterruptedMessages(
    [
      {
        id: "assistant",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "bash",
            toolCallId: "done",
            state: "output-available",
            input: { command: "pwd" },
            output: { ok: true },
          },
          {
            type: "dynamic-tool",
            toolName: "bash",
            toolCallId: "pending",
            state: "approval-requested",
            input: { command: "rm result.txt" },
            approval: { id: "approval-2" },
          },
        ],
      } as UIMessage,
    ],
    "运行已中断",
  );

  assert.equal((messages[0]?.parts[0] as { state?: string } | undefined)?.state, "output-available");
  assert.deepEqual(messages[0]?.parts[1], {
    type: "dynamic-tool",
    toolName: "bash",
    toolCallId: "pending",
    state: "output-error",
    input: { command: "rm result.txt" },
    errorText: "运行已中断",
  });
});
