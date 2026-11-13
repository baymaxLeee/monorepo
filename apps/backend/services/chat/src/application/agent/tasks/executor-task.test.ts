import assert from "node:assert/strict";
import test from "node:test";

import type { Task } from "../../../infrastructure/clients/executor.js";
import { startExecutorTask } from "./executor-task.js";

const task: Task = {
  id: "task-id",
  type: "image-generation",
  status: "running",
  ownerService: "chat",
  ownerRef: "tool-call",
  result: null,
  progress: null,
  error: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  finishedAt: null,
};

test("executor task helper returns as soon as submission is accepted", async () => {
  let calls = 0;
  const result = await startExecutorTask(
    {
      type: "image-generation",
      ownerRef: "tool-call",
      payload: {
        tenantId: "tenant",
        workspaceId: "workspace",
        userId: "user",
        providerId: "provider",
        prompts: ["image"],
        idempotencyKey: "tool-call",
      },
    },
    undefined,
    async () => {
      calls += 1;
      return task;
    },
  );

  assert.equal(calls, 1);
  assert.equal(result, task);
});

test("executor task helper does not submit an already-aborted tool call", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;

  await assert.rejects(
    startExecutorTask(
      {
        type: "image-generation",
        ownerRef: "tool-call",
        payload: {
          tenantId: "tenant",
          workspaceId: "workspace",
          userId: "user",
          providerId: "provider",
          prompts: ["image"],
          idempotencyKey: "tool-call",
        },
      },
      controller.signal,
      async () => {
        called = true;
        return task;
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(called, false);
});
