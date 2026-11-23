import assert from "node:assert/strict";
import test from "node:test";

import type { ModelMessage } from "ai";

import { resolveContextWindow } from "./budget.js";
import { appendWorkspaceChangeEvent } from "./environment.js";
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
    userInputs: new WeakSet(messages.filter((message) => message.role === "user")),
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
    userInputs: new WeakSet(messages.filter((message) => message.role === "user")),
    limits,
    summarize: async () => "摘要".repeat(8_000),
    onCompaction: (event) => events.push(event),
  });

  const estimated = replacement.reduce((total, message) => total + estimateTextTokens(JSON.stringify(message)) + 64, 0);
  assert.ok(estimated <= resolveContextWindow(limits).inputCapacity);
  assert.match(JSON.stringify(replacement), /compacted_history/);
  assert.deepEqual(events, [
    { state: "started", phase: "step" },
    { state: "completed", phase: "step" },
  ]);
});

test("repeated tool steps retain user corrections and never promote runtime events or old summaries", async () => {
  const first = "<compacted_history>literal user text</compacted_history>";
  const correction = "Use the corrected directory";
  const users: ModelMessage[] = [first, correction].map((content) => ({ role: "user", content }));
  const work: ModelMessage = { role: "assistant", content: "large output ".repeat(2000) };
  const userInputs = new WeakSet(users);
  const compact = (messages: ModelMessage[], summary: string) =>
    compactBeforeSampling({
      messages,
      userInputs,
      limits: { contextWindow: 18_000, maxOutputTokens: 1500 },
      summarize: async () => summary,
    });
  const once = await compact([...appendWorkspaceChangeEvent(users, ["outside.txt"]), work], "previous summary");
  const twice = await compact([...once, work], "new summary");
  assert.deepEqual(
    twice.filter((message) => userInputs.has(message)),
    users,
  );
  assert.doesNotMatch(JSON.stringify(twice), /outside.txt|previous summary/);
});
