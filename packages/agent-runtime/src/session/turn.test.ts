import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";

import { RuntimeTurn } from "./turn.js";

const finish: LanguageModelV4StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
};

function model(): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("stream only");
    },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "answer" });
          controller.enqueue({ type: "text-delta", id: "answer", delta: "done" });
          controller.enqueue({ type: "text-end", id: "answer" });
          controller.enqueue(finish);
          controller.close();
        },
      }),
    }),
  };
}

test("owns the input queue before sampling and finalizes host resources once", async () => {
  const turn = new RuntimeTurn();
  let disposals = 0;
  const started = await turn.start(async (scope) => {
    assert.equal(scope.signal, turn.signal);
    scope.defer(() => {
      disposals++;
    });
    return {
      messages: [{ role: "user", content: "work" }],
      settings: { model: model(), tools: {} },
      host: { kind: "test" },
    };
  });
  assert.equal(await started.result.text, "done");
  assert.deepEqual(started.host, { kind: "test" });
  await Promise.all([turn.dispose(), turn.dispose()]);
  assert.equal(disposals, 1);
  assert.throws(() => turn.start(async () => ({ messages: [], settings: { model: model() }, host: null })));

  const disposed = new RuntimeTurn();
  await disposed.dispose();
  assert.throws(
    () => disposed.start(async () => ({ messages: [], settings: { model: model() }, host: null })),
    /runtime turn already disposed/,
  );
});

test("preparation failure settles admitted inputs before a host drains its inbox", { timeout: 1000 }, async () => {
  const turn = new RuntimeTurn();
  const admission = turn.input.submit("follow up", { id: "one", mode: "follow-up" });
  await assert.rejects(
    turn.start(async () => {
      throw new Error("setup failed");
    }),
    /setup failed/,
  );
  const result = await admission;
  assert.equal(result.type, "not-delivered");
  if (result.type === "not-delivered") assert.equal(result.reason, "error");
});

test("closing during preparation releases acquired resources without starting the model", async () => {
  let releasePreparation!: () => void;
  const preparing = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });
  let releases = 0;
  const turn = new RuntimeTurn();
  const start = turn.start(async (scope) => {
    await preparing;
    scope.defer(() => {
      releases++;
    });
    return { messages: [{ role: "user", content: "work" }], settings: { model: model() }, host: null };
  });
  await Promise.resolve();
  const disposing = turn.dispose();
  releasePreparation();
  await assert.rejects(start, /disposed/);
  await disposing;
  assert.equal(releases, 1);
});

test("startup rollback releases resources in reverse acquisition order even when one fails", async () => {
  const turn = new RuntimeTurn();
  const released: string[] = [];
  await assert.rejects(
    turn.start(async (scope) => {
      scope.defer(() => {
        released.push("catalog");
      });
      scope.defer(() => {
        released.push("sandbox");
        throw new Error("snapshot failed");
      });
      throw new Error("model setup failed");
    }),
    (error) =>
      error instanceof AggregateError &&
      error.errors.map((cause) => cause.message).join(",") === "model setup failed,snapshot failed",
  );
  await turn.dispose();
  assert.deepEqual(released, ["sandbox", "catalog"]);
});
