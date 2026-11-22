import assert from "node:assert/strict";
import test from "node:test";

import type { ModelMessage } from "ai";

import { resolveContextWindow } from "./budget.js";
import { compactBeforeSampling } from "./step-compaction.js";
import { estimateTextTokens } from "./token-estimate.js";

test("oversized tool output is summarized together with its call before the next sample", async () => {
  const question: ModelMessage = { role: "user", content: "record the result" };
  const messages: ModelMessage[] = [
    question,
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "call", toolName: "read", input: {} }] },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call",
          toolName: "read",
          output: { type: "text", value: "data ".repeat(2000) },
        },
      ],
    },
  ];
  const replacement = await compactBeforeSampling({
    messages,
    limits: { contextWindow: 10_000, maxOutputTokens: 1000 },
    summarize: async (prefix) => {
      assert.match(prefix.join(""), /tool-call/);
      assert.match(prefix.join(""), /tool-result/);
      return "recorded evidence";
    },
  });
  assert.deepEqual(replacement.at(-1), question);
  assert.equal(
    replacement.some((message) => message.role === "tool"),
    false,
  );
  assert.match(JSON.stringify(replacement), /recorded evidence/);
  assert.equal(messages.length, 3);
});

test("bounds an oversized summary before installing the compacted history", async () => {
  const limits = { contextWindow: 15_000, maxOutputTokens: 12_000 };
  const events: unknown[] = [];
  const messages: ModelMessage[] = Array.from({ length: 8 }, (_, index) => ({
    role: "user",
    content: `evidence-${index}-${"x".repeat(2_000)}`,
  }));

  const replacement = await compactBeforeSampling({
    messages,
    limits,
    summarize: async () => "摘要".repeat(8_000),
    onCompaction: (event) => events.push(event),
  });

  const estimated = replacement.reduce((total, message) => total + estimateTextTokens(JSON.stringify(message)) + 64, 0);
  assert.ok(estimated <= resolveContextWindow(limits).inputCapacity);
  assert.match(JSON.stringify(replacement[0]), /compacted_history/);
  assert.deepEqual(events, [
    { state: "started", phase: "step" },
    { state: "completed", phase: "step" },
  ]);
});
