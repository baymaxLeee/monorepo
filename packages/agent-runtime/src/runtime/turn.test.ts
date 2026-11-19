import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";

import { createRuntimeTurn } from "./turn.js";

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
  const turn = createRuntimeTurn();
  let disposals = 0;
  const started = await turn.start({
    messages: [{ role: "user", content: "work" }],
    prepare: async (input) => {
      assert.equal(input, turn.input);
      return {
        settings: { model: model(), tools: {} },
        host: { kind: "test" },
        dispose: async () => {
          disposals += 1;
        },
      };
    },
  });
  assert.equal(await started.result.text, "done");
  assert.deepEqual(started.host, { kind: "test" });
  await Promise.all([turn.dispose(), turn.dispose()]);
  assert.equal(disposals, 1);
  assert.throws(() =>
    turn.start({ messages: [], prepare: async () => ({ settings: { model: model() }, host: null }) }),
  );

  const disposed = createRuntimeTurn();
  await disposed.dispose();
  assert.throws(
    () => disposed.start({ messages: [], prepare: async () => ({ settings: { model: model() }, host: null }) }),
    /runtime turn already disposed/,
  );
});
