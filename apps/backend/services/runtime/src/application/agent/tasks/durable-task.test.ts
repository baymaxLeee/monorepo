import assert from "node:assert/strict";
import test from "node:test";

import type { Task } from "../../../infrastructure/clients/worker.js";
import { runDurableTask } from "./durable-task.js";

const task: Task = {
  id: "task-id",
  type: "image-generation",
  status: "running",
  ownerService: "runtime",
  ownerRef: "tool-call",
  result: null,
  progress: null,
  error: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  finishedAt: null,
};

function snapshot(status: Task["status"], result: unknown = null): Task {
  return {
    ...task,
    status,
    result,
    error: status === "failed" ? "provider failed" : null,
    finishedAt: status === "running" || status === "queued" ? null : new Date(1).toISOString(),
  };
}

test("durable tool waits for the admitted task result", async () => {
  let calls = 0;
  const result = await runDurableTask(
    {
      type: "image-generation",
      ownerRef: "tool-call",
      payload: {
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
          providerKind: "image",
          isDefault: true,
        },
        prompts: ["image"],
        references: [],
        idempotencyKey: "tool-call",
      },
    },
    undefined,
    {
      start: async () => {
        calls += 1;
        return task;
      },
      get: async () => assert.fail("completed stream must not poll"),
      async *watch() {
        yield { task: snapshot("running") };
        yield { task: snapshot("completed", { images: [{ file: "image.png" }] }) };
      },
      waitBeforeReconnect: async () => assert.fail("completed stream must not reconnect"),
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.result, { images: [{ file: "image.png" }] });
});

test("durable tool reattaches when the first stream ends before Workflow linkage", async () => {
  let watches = 0;
  let reads = 0;
  const result = await runDurableTask(
    {
      type: "image-generation",
      ownerRef: "tool-call",
      payload: {
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
          providerKind: "image",
          isDefault: true,
        },
        prompts: ["image"],
        references: [],
        idempotencyKey: "tool-call",
      },
    },
    undefined,
    {
      start: async () => snapshot("queued"),
      get: async () => {
        reads += 1;
        return reads === 1 ? snapshot("running") : snapshot("completed", { ok: true });
      },
      async *watch() {
        watches += 1;
        if (watches > 1) yield { task: snapshot("completed", { ok: true }) };
      },
      waitBeforeReconnect: async () => undefined,
    },
  );

  assert.equal(watches, 2);
  assert.equal(reads, 1);
  assert.deepEqual(result.result, { ok: true });
});

test("durable tool reports a terminal task failure", async () => {
  await assert.rejects(
    runDurableTask(
      {
        type: "image-generation",
        ownerRef: "tool-call",
        payload: {
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
            providerKind: "image",
            isDefault: true,
          },
          prompts: ["image"],
          references: [],
          idempotencyKey: "tool-call",
        },
      },
      undefined,
      {
        start: async () => snapshot("failed"),
        get: async () => assert.fail("terminal task must not poll"),
        async *watch() {
          assert.fail("terminal task must not stream");
        },
        waitBeforeReconnect: async () => assert.fail("terminal task must not reconnect"),
      },
    ),
    /provider failed/,
  );
});

test("durable task helper does not submit an already-aborted tool call", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;

  await assert.rejects(
    runDurableTask(
      {
        type: "image-generation",
        ownerRef: "tool-call",
        payload: {
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
            providerKind: "image",
            isDefault: true,
          },
          prompts: ["image"],
          references: [],
          idempotencyKey: "tool-call",
        },
      },
      controller.signal,
      {
        start: async () => {
          called = true;
          return task;
        },
        get: async () => task,
        async *watch() {
          yield { task };
        },
        waitBeforeReconnect: async () => undefined,
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(called, false);
});
