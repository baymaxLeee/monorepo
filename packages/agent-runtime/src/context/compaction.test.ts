import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { UIMessage } from "ai";

import { compactRuntimeHistory } from "./compaction.js";

const finish: LanguageModelV4StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 2, text: 2, reasoning: 0 },
  },
};

test("feeds every chunk of an oversized single message to the compactor", async () => {
  const prompts: string[] = [];
  const model: LanguageModelV4 = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "compactor",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("stream only");
    },
    doStream: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "summary" });
            controller.enqueue({
              type: "text-delta",
              id: "summary",
              delta: `summary pass ${prompts.length}`,
            });
            controller.enqueue({ type: "text-end", id: "summary" });
            controller.enqueue(finish);
            controller.close();
          },
        }),
      };
    },
  };
  const messages: UIMessage[] = [
    { id: "large", role: "user", parts: [{ type: "text", text: `START-${"x".repeat(6_000)}-END` }] },
  ];

  const result = await compactRuntimeHistory({
    model,
    limits: { contextWindow: 2_000, maxOutputTokens: 512 },
    messages,
    previous: null,
  });

  assert.ok(prompts.length > 1);
  assert.match(prompts[0]!, /START/);
  assert.match(prompts.at(-1)!, /END/);
  assert.match(prompts[0]!, /final=\\\"false\\\"/);
  assert.match(prompts.at(-1)!, /final=\\\"true\\\"/);
  assert.equal(result.state.summary, `summary pass ${prompts.length}`);
});

test("accepts the compactor's plain-text summary without requiring structured output", async () => {
  const model: LanguageModelV4 = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "compactor",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("stream only");
    },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "summary" });
          controller.enqueue({ type: "text-delta", id: "summary", delta: "durable plain-text summary" });
          controller.enqueue({ type: "text-end", id: "summary" });
          controller.enqueue(finish);
          controller.close();
        },
      }),
    }),
  };

  const result = await compactRuntimeHistory({
    model,
    limits: { contextWindow: 2_000, maxOutputTokens: 512 },
    messages: [{ id: "old", role: "user", parts: [{ type: "text", text: "important history" }] }],
    previous: null,
  });

  assert.equal(result.state.summary, "durable plain-text summary");
});

test("retries only the interrupted compaction model call", async () => {
  let calls = 0;
  const model: LanguageModelV4 = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "compactor",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("stream only");
    },
    doStream: async () => {
      calls++;
      return {
        stream: new ReadableStream({
          start(controller) {
            if (calls === 1) {
              controller.enqueue({ type: "error", error: { retryable: true, message: "connection reset" } });
              controller.close();
              return;
            }
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "summary" });
            controller.enqueue({ type: "text-delta", id: "summary", delta: "summary after reconnect" });
            controller.enqueue({ type: "text-end", id: "summary" });
            controller.enqueue(finish);
            controller.close();
          },
        }),
      };
    },
  };

  const result = await compactRuntimeHistory({
    model,
    limits: { contextWindow: 2_000, maxOutputTokens: 512 },
    messages: [{ id: "old", role: "user", parts: [{ type: "text", text: "important history" }] }],
    previous: null,
  });

  assert.equal(calls, 2);
  assert.equal(result.state.summary, "summary after reconnect");
});
