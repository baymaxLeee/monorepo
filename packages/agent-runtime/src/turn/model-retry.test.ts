import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError } from "ai";

import { createAgentLoop } from "./loop.js";
import {
  MODEL_STREAM_RETRIES,
  classifyModelNetworkFailure,
  createRetryableModelStreamMiddleware,
  createModelStreamRetryPolicy,
  isRetryableNetworkError,
  retryableModelStreamMiddleware,
  retryTransientNetwork,
  waitForTransientRetry,
} from "./model-retry.js";

const finish: LanguageModelV4StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
};

test("classifies transient network failures without replaying terminal HTTP failures", () => {
  assert.equal(
    classifyModelNetworkFailure(
      Object.assign(new Error("getaddrinfo ENOTFOUND provider.example"), { code: "ENOTFOUND" }),
    ),
    "dns",
  );
  assert.equal(classifyModelNetworkFailure(new DOMException("Provider request timeout", "TimeoutError")), "timeout");
  assert.equal(classifyModelNetworkFailure(new Error("ERR_INCOMPLETE_CHUNKED_ENCODING")), "incomplete_stream");
  assert.equal(isRetryableNetworkError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })), true);
  assert.equal(isRetryableNetworkError({ retryable: true }), true);
  assert.equal(isRetryableNetworkError({ statusCode: 503 }), true);
  assert.equal(isRetryableNetworkError({ statusCode: 400, message: "input is invalid" }), false);
  assert.equal(isRetryableNetworkError({ retryable: true, statusCode: 400, message: "input is invalid" }), false);
  assert.equal(isRetryableNetworkError({ retryable: false, statusCode: 503 }), false);
});

test("provider middleware exposes only transient failures as retry parts", async () => {
  const retryable = new APICallError({
    message: "unavailable",
    url: "https://provider.test/responses",
    requestBodyValues: {},
    statusCode: 503,
    responseHeaders: {},
    responseBody: "unavailable",
    isRetryable: true,
  });
  const retryResult = await retryableModelStreamMiddleware.wrapStream!({
    doStream: async () => {
      throw retryable;
    },
    doGenerate: async () => {
      throw new Error("unused");
    },
    params: { prompt: [] },
    model: {} as never,
  });
  assert.deepEqual(await retryResult.stream.getReader().read(), {
    done: false,
    value: { type: "error", error: retryable },
  });

  const terminal = { statusCode: 400, retryable: false, message: "invalid input" };
  const terminalResult = await retryableModelStreamMiddleware.wrapStream!({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "error", error: terminal });
          controller.close();
        },
      }),
    }),
    doGenerate: async () => {
      throw new Error("unused");
    },
    params: { prompt: [] },
    model: {} as never,
  });
  await assert.rejects(
    () => terminalResult.stream.getReader().read(),
    (error) => error === terminal,
  );
});

test("retry policy reports three attempts, recovery and exhaustion", async () => {
  const events: unknown[] = [];
  const policy = createModelStreamRetryPolicy({ emit: (event) => events.push(event), wait: async () => {} });
  for (let attempt = 0; attempt < MODEL_STREAM_RETRIES; attempt++) await policy.onError({ error: { retryable: true } });
  policy.onChunk({ chunk: { type: "text-delta" } });
  assert.deepEqual(events, [
    { state: "retrying", attempt: 1, maxAttempts: 3, reason: "provider_unavailable" },
    { state: "retrying", attempt: 2, maxAttempts: 3, reason: "provider_unavailable" },
    { state: "retrying", attempt: 3, maxAttempts: 3, reason: "provider_unavailable" },
    { state: "recovered", attempt: 3, maxAttempts: 3, reason: "provider_unavailable" },
  ]);

  policy.reset();
  events.length = 0;
  for (let attempt = 0; attempt <= MODEL_STREAM_RETRIES; attempt++)
    await policy.onError({ error: { retryable: true } });
  assert.deepEqual(events.at(-1), {
    state: "failed",
    attempt: 3,
    maxAttempts: 3,
    reason: "provider_unavailable",
  });
});

test("the shared SDK loop retries only the current sample after partial output", async () => {
  let calls = 0;
  const events: unknown[] = [];
  const policy = createModelStreamRetryPolicy({ emit: (event) => events.push(event), wait: async () => {} });
  const model: LanguageModelV4 = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("stream only");
    },
    doStream: async () => {
      calls++;
      const parts: LanguageModelV4StreamPart[] =
        calls === 1
          ? [
              { type: "text-start", id: "partial" },
              { type: "text-delta", id: "partial", delta: "partial" },
              { type: "error", error: { isRetryable: true, message: "connection reset" } },
            ]
          : [
              { type: "text-start", id: "answer" },
              { type: "text-delta", id: "answer", delta: "recovered" },
              { type: "text-end", id: "answer" },
              finish,
            ];
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  };
  const agent = createAgentLoop({
    model,
    tools: {},
    maxRetries: 0,
    streamRetries: MODEL_STREAM_RETRIES,
    middleware: [retryableModelStreamMiddleware],
    onStepStart: policy.reset,
    onChunk: policy.onChunk,
    onError: policy.onError,
  });
  const result = await agent.stream({ messages: [{ role: "user", content: "hello" }] });
  await result.consumeStream();
  assert.equal(calls, 2);
  assert.deepEqual(events, [
    { state: "retrying", attempt: 1, maxAttempts: 3, reason: "connection_reset" },
    { state: "recovered", attempt: 1, maxAttempts: 3, reason: "connection_reset" },
  ]);
});

test("the shared SDK loop never retries a terminal provider 400", async () => {
  let calls = 0;
  const events: unknown[] = [];
  const policy = createModelStreamRetryPolicy({ emit: (event) => events.push(event), wait: async () => {} });
  const model: LanguageModelV4 = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("stream only");
    },
    doStream: async () => {
      calls++;
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({
              type: "error",
              error: { isRetryable: false, statusCode: 400, message: "input is invalid" },
            });
            controller.close();
          },
        }),
      };
    },
  };
  const agent = createAgentLoop({
    model,
    tools: {},
    maxRetries: 0,
    streamRetries: MODEL_STREAM_RETRIES,
    middleware: [retryableModelStreamMiddleware],
    onStepStart: policy.reset,
    onChunk: policy.onChunk,
    onError: policy.onError,
  });
  const result = await agent.stream({ messages: [{ role: "user", content: "hello" }] });
  try {
    await result.consumeStream();
  } catch {
    // The terminal stream failure is the expected outcome under test.
  }
  assert.equal(calls, 1);
  assert.deepEqual(events, []);
});

test("a provider stream can remain idle until data arrives or the caller cancels", async () => {
  let calls = 0;
  let cancellations = 0;
  const events: unknown[] = [];
  const policy = createModelStreamRetryPolicy({ emit: (event) => events.push(event), wait: async () => {} });
  const model: LanguageModelV4 = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("stream only");
    },
    doStream: async () => {
      calls++;
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            setTimeout(() => {
              controller.enqueue({ type: "text-start", id: "answer" });
              controller.enqueue({ type: "text-delta", id: "answer", delta: "slow response" });
              controller.enqueue({ type: "text-end", id: "answer" });
              controller.enqueue(finish);
              controller.close();
            }, 30);
          },
          cancel() {
            cancellations++;
          },
        }),
      };
    },
  };
  const agent = createAgentLoop({
    model,
    tools: {},
    maxRetries: 0,
    streamRetries: MODEL_STREAM_RETRIES,
    middleware: [createRetryableModelStreamMiddleware()],
    onStepStart: policy.reset,
    onChunk: policy.onChunk,
    onError: policy.onError,
  });
  const result = await agent.stream({ messages: [{ role: "user", content: "hello" }] });
  await result.consumeStream();
  assert.equal(calls, 1);
  assert.equal(cancellations, 0);
  assert.deepEqual(events, []);
});

test("provider keepalives preserve a slow model request without retrying", async () => {
  let calls = 0;
  let cancellations = 0;
  const model: LanguageModelV4 = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("stream only");
    },
    doStream: async () => {
      calls++;
      let pingTimer: ReturnType<typeof setInterval>;
      let outputTimer: ReturnType<typeof setTimeout>;
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            pingTimer = setInterval(() => controller.enqueue({ type: "ping" }), 5);
            outputTimer = setTimeout(() => {
              clearInterval(pingTimer);
              controller.enqueue({ type: "text-start", id: "answer" });
              controller.enqueue({ type: "text-delta", id: "answer", delta: "slow response" });
              controller.enqueue({ type: "text-end", id: "answer" });
              controller.enqueue(finish);
              controller.close();
            }, 120);
          },
          cancel() {
            cancellations++;
            clearInterval(pingTimer);
            clearTimeout(outputTimer);
          },
        }),
      };
    },
  };
  const agent = createAgentLoop({
    model,
    tools: {},
    maxRetries: 0,
    streamRetries: MODEL_STREAM_RETRIES,
    middleware: [createRetryableModelStreamMiddleware()],
  });
  const result = await agent.stream({ messages: [{ role: "user", content: "hello" }] });
  await result.consumeStream();
  assert.equal(calls, 1);
  assert.equal(cancellations, 0);
});

test("read-only network retry runs at most three retries", async () => {
  let calls = 0;
  const value = await retryTransientNetwork(
    async () => {
      calls++;
      if (calls <= MODEL_STREAM_RETRIES) throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
      return "ok";
    },
    { wait: async () => {} },
  );
  assert.equal(value, "ok");
  assert.equal(calls, 4);
});

test("transient retries honor provider Retry-After advice", async () => {
  await waitForTransientRetry(1, AbortSignal.timeout(50), {
    responseHeaders: { "retry-after": "0" },
  });
});
