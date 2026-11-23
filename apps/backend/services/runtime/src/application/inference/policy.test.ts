import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { LanguageModelV4StreamPart, LanguageModelV4CallOptions } from "@ai-sdk/provider";

import { inferenceResponse, type RelayProvider } from "./policy.js";
const finish: LanguageModelV4StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 3, text: 3, reasoning: 0 },
  },
};
const request = () => ({
  requestId: randomUUID(),
  providerId: "provider",
  reasoningEffort: "medium" as const,
  model: "authorized",
  options: {
    prompt: [{ role: "user", content: [{ type: "text", text: "local file contents" }] }],
    maxOutputTokens: 100,
  },
});
function fixture(
  parts: LanguageModelV4StreamPart[] = [finish],
  contextWindow = 10_000,
  streamError?: Error,
  startError?: Error,
) {
  const calls: LanguageModelV4CallOptions[] = [];
  let cancelled = false;
  const provider: RelayProvider = {
    config: {
      providerId: "provider",
      providerName: "test",
      reasoningEffort: "medium",
      instructions: "",
      model: "authorized",
      maxOutputTokens: 100,
      contextWindow,
    },
    model: {
      specificationVersion: "v4",
      provider: "test",
      modelId: "authorized",
      supportedUrls: {},
      doGenerate: () => {
        throw new Error("unused");
      },
      doStream: async (options) => {
        calls.push(options);
        if (startError) throw startError;
        let nextPart = 0;
        return {
          stream: new ReadableStream({
            pull(controller) {
              const part = parts[nextPart++];
              if (part) controller.enqueue(part);
              else if (streamError) controller.error(streamError);
              else controller.close();
            },
            cancel() {
              cancelled = true;
            },
          }),
        };
      },
    },
  };
  return { provider, calls, cancelled: () => cancelled };
}
test("relay compares estimated input tokens with the context window instead of JSON bytes", async () => {
  const f = fixture([finish], 3_000);
  const payload = request();
  payload.options.prompt[0]!.content[0]!.text = "本".repeat(2_000);

  const response = await inferenceResponse(f.provider, payload, new AbortController().signal);

  assert.equal(response.status, 200);
  await response.body?.cancel();
});
test("relay emits native provider parts and strips provider persistence/diagnostics", async () => {
  const f = fixture([
    { type: "response-metadata", id: "opaque-secret" },
    { type: "raw", rawValue: { credentials: "secret" } },
    finish,
  ]);
  const response = await inferenceResponse(f.provider, request(), new AbortController().signal);
  const output = await response.text();
  assert.equal(JSON.parse(output).type, "finish");
  assert.ok(!output.includes("secret"));
  assert.deepEqual(f.calls[0]?.providerOptions, { openai: { store: false } });
  assert.equal(f.calls[0]?.includeRawChunks, false);
});
test("relay explicitly keeps the HTTP response in chunked streaming mode", async () => {
  const f = fixture([{ type: "stream-start", warnings: [] }, finish]);

  const response = await inferenceResponse(f.provider, request(), new AbortController().signal);

  assert.equal(response.headers.get("transfer-encoding"), "chunked");
  await response.body?.cancel();
});
test("unauthorized model, injected provider options, remote URLs and hosted tools never reach provider", async () => {
  for (const payload of [
    { ...request(), model: "other" },
    { ...request(), options: { ...request().options, providerOptions: { openai: { store: true } } } },
    { ...request(), options: { ...request().options, tools: [{ type: "provider", id: "web" }] } },
    {
      ...request(),
      options: {
        ...request().options,
        prompt: [
          {
            role: "user",
            content: [{ type: "file", mediaType: "text/plain", data: { type: "url", url: "http://private" } }],
          },
        ],
      },
    },
  ]) {
    const f = fixture();
    await assert.rejects(inferenceResponse(f.provider, payload, new AbortController().signal));
    assert.equal(f.calls.length, 0);
  }
});
test("a connection failure before semantic output is retryable and keeps the reservation", async () => {
  const f = fixture([]);
  const response = await inferenceResponse(f.provider, request(), new AbortController().signal);
  assert.deepEqual(JSON.parse(await response.text()), {
    type: "error",
    error: {
      code: "model_connection_failed",
      message: "模型响应流提前中断",
      retryable: true,
      reason: "incomplete_stream",
    },
  });
  assert.equal(f.calls.length, 1);
});

test("a provider connection failure before the stream starts uses the same retryable protocol", async () => {
  const f = fixture([], 10_000, undefined, new TypeError("fetch failed"));
  const response = await inferenceResponse(f.provider, request(), new AbortController().signal);
  assert.deepEqual(JSON.parse(await response.text()), {
    type: "error",
    error: {
      code: "model_connection_failed",
      message: "模型服务暂时不可用",
      retryable: true,
      reason: "provider_unavailable",
    },
  });
  assert.equal(f.calls.length, 1);
});

test("a connection drop after partial semantic output remains retryable", async () => {
  const f = fixture([
    { type: "text-start", id: "answer" },
    { type: "text-delta", id: "answer", delta: "partial" },
  ]);
  const response = await inferenceResponse(f.provider, request(), new AbortController().signal);
  const output = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LanguageModelV4StreamPart);
  assert.deepEqual(output.at(-1), {
    type: "error",
    error: {
      code: "model_connection_failed",
      message: "模型响应流提前中断",
      retryable: true,
      reason: "incomplete_stream",
    },
  });
  assert.equal(f.calls.length, 1);
});

test("provider-hosted execution remains a terminal protocol violation", async () => {
  const f = fixture([
    {
      type: "tool-call",
      toolCallId: "x",
      toolName: "shell",
      input: "{}",
      providerExecuted: true,
    } satisfies LanguageModelV4StreamPart,
  ]);
  const response = await inferenceResponse(f.provider, request(), new AbortController().signal);
  const output = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LanguageModelV4StreamPart);
  assert.deepEqual(output.at(-1), {
    type: "error",
    error: {
      code: "model_stream_interrupted",
      message: "模型响应协议错误，请重新发送消息",
      retryable: false,
      reason: "protocol",
    },
  });
  assert.equal(f.calls.length, 1);
});

test("a socket failure after only stream metadata remains retryable", async () => {
  const f = fixture([{ type: "stream-start", warnings: [] }], 10_000, new Error("upstream socket closed"));
  const response = await inferenceResponse(f.provider, request(), new AbortController().signal);
  const parts = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LanguageModelV4StreamPart);
  assert.deepEqual(parts, [
    { type: "stream-start", warnings: [] },
    {
      type: "error",
      error: {
        code: "model_connection_failed",
        message: "模型连接被重置",
        retryable: true,
        reason: "connection_reset",
      },
    },
  ]);
  assert.equal(f.calls.length, 1);
});
test("pre-aborted requests do not call a model", async () => {
  const f = fixture();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(inferenceResponse(f.provider, request(), abort.signal));
  assert.equal(f.calls.length, 0);
});
