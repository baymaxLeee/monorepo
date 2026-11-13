import assert from "node:assert/strict";
import test from "node:test";

import { cancelImageGeneration } from "./cancel.js";

const input = {
  tenantId: "tenant",
  workspaceId: "workspace",
  userId: "user",
  conversationId: "conversation",
  providerId: "provider",
  prompts: ["first", "second"],
  idempotencyKey: "tool-call",
};

test("image cancellation removes every durable document recorded by the workflow", async () => {
  const removed: Array<[string, string]> = [];
  await cancelImageGeneration(
    input,
    { done: 2, total: 2, externalTaskIds: ["document-1", "document-2"] },
    { taskId: "task" },
    async (userId, documentId) => {
      removed.push([userId, documentId]);
    },
  );

  assert.deepEqual(removed, [
    ["user", "document-1"],
    ["user", "document-2"],
  ]);
});

test("image cancellation is a no-op before any document is persisted", async () => {
  let called = false;
  await cancelImageGeneration(input, { done: 0, total: 2 }, { taskId: "task" }, async () => {
    called = true;
  });
  assert.equal(called, false);
});
