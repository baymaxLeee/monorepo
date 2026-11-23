import assert from "node:assert/strict";
import test from "node:test";

import { cancelImageGeneration } from "./cancel.js";

const input = {
  sessionId: "session",
  provider: {
    id: "provider",
    name: "Image Provider",
    model: "image-model",
    baseUrl: "https://provider.example/v1",
    apiKey: "secret",
    extraBody: {},
    contextWindow: 0,
    maxOutputTokens: 0,
    pricing: null,
    providerKind: "image" as const,
    isDefault: true,
  },
  prompts: ["first", "second"],
  references: [],
  idempotencyKey: "tool-call",
};

test("image cancellation releases every task-owned Storage claim", async () => {
  const removed: Array<[string, string]> = [];
  await cancelImageGeneration(
    input,
    { done: 2, total: 2, externalTaskIds: ["image:0", "image:1"] },
    { taskId: "task" },
    async (taskId, slot) => {
      removed.push([taskId, slot]);
    },
  );

  assert.deepEqual(removed, [
    ["task", "image:0"],
    ["task", "image:1"],
  ]);
});

test("image cancellation is a no-op before any task asset is claimed", async () => {
  let called = false;
  await cancelImageGeneration(input, { done: 0, total: 2 }, { taskId: "task" }, async () => {
    called = true;
  });
  assert.equal(called, false);
});
