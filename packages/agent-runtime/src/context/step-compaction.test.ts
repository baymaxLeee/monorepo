import assert from "node:assert/strict";
import test from "node:test";

import type { ModelMessage } from "ai";

import { compactBeforeSampling } from "./step-compaction.js";

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
