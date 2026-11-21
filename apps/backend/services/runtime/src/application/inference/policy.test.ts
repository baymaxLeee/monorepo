import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { LanguageModelV4StreamPart, LanguageModelV4CallOptions } from "@ai-sdk/provider";

import type { AuthContext } from "../../api/http/middleware/auth.js";
import { inferenceResponse, type RelayDependencies } from "./policy.js";

const auth: AuthContext = {
  userId: "user",
  username: "test",
  email: "",
  tenantId: "tenant",
  workspaceId: "workspace",
  workspaceRole: "member",
  roles: [],
};
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
  const charges: (number | null)[] = [],
    calls: LanguageModelV4CallOptions[] = [],
    reserved: number[] = [];
  let cancelled = false;
  const deps: RelayDependencies = {
    resolve: async () => ({
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
    }),
    reserve: async (_auth, _id, _model, tokens) => {
      reserved.push(tokens);
      return {
        async settle(tokens) {
          charges.push(tokens);
        },
      };
    },
  };
  return { deps, charges, calls, reserved, cancelled: () => cancelled };
}
test("relay compares estimated input tokens with the context window instead of JSON bytes", async () => {
  const f = fixture([finish], 3_000);
  const payload = request();
  payload.options.prompt[0]!.content[0]!.text = "本".repeat(2_000);

  const response = await inferenceResponse(auth, payload, new AbortController().signal, f.deps);

  assert.equal(response.status, 200);
  await response.body?.cancel();
});
test("relay emits native provider parts, meters once and strips provider persistence/diagnostics", async () => {
  const f = fixture([
    { type: "response-metadata", id: "opaque-secret" },
    { type: "raw", rawValue: { credentials: "secret" } },
    finish,
  ]);
  const response = await inferenceResponse(auth, request(), new AbortController().signal, f.deps);
  const output = await response.text();
  assert.equal(JSON.parse(output).type, "finish");
  assert.ok(!output.includes("secret"));
  assert.deepEqual(f.charges, [15]);
  assert.deepEqual(f.reserved, [10100]);
  assert.deepEqual(f.calls[0]?.providerOptions, { openai: { store: false } });
  assert.equal(f.calls[0]?.includeRawChunks, false);
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
    await assert.rejects(inferenceResponse(auth, payload, new AbortController().signal, f.deps));
    assert.equal(f.calls.length, 0);
    assert.equal(f.reserved.length, 0);
  }
});
test("a connection failure before semantic output is retryable and keeps the reservation", async () => {
  const f = fixture([]);
  const response = await inferenceResponse(auth, request(), new AbortController().signal, f.deps);
  assert.deepEqual(JSON.parse(await response.text()), {
    type: "error",
    error: {
      code: "model_connection_failed",
      message: "模型连接中断",
      retryable: true,
    },
  });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.charges, [null]);
});

test("a provider connection failure before the stream starts uses the same retryable protocol", async () => {
  const f = fixture([], 10_000, undefined, new TypeError("fetch failed"));
  const response = await inferenceResponse(auth, request(), new AbortController().signal, f.deps);
  assert.deepEqual(JSON.parse(await response.text()), {
    type: "error",
    error: {
      code: "model_connection_failed",
      message: "模型连接中断",
      retryable: true,
    },
  });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.charges, [null]);
});

test("a failure after semantic output or hosted execution is not retryable", async () => {
  for (const parts of [
    [
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: "partial" },
    ] satisfies LanguageModelV4StreamPart[],
    [
      {
        type: "tool-call",
        toolCallId: "x",
        toolName: "shell",
        input: "{}",
        providerExecuted: true,
      } satisfies LanguageModelV4StreamPart,
    ],
  ]) {
    const f = fixture(parts);
    const response = await inferenceResponse(auth, request(), new AbortController().signal, f.deps);
    const output = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as LanguageModelV4StreamPart);
    assert.deepEqual(output.at(-1), {
      type: "error",
      error: {
        code: "model_stream_interrupted",
        message: "模型响应中断，请重新发送消息",
        retryable: false,
      },
    });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.charges, [null]);
  }
});

test("a socket failure after only stream metadata remains retryable", async () => {
  const f = fixture([{ type: "stream-start", warnings: [] }], 10_000, new Error("upstream socket closed"));
  const response = await inferenceResponse(auth, request(), new AbortController().signal, f.deps);
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
        message: "模型连接中断",
        retryable: true,
      },
    },
  ]);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.charges, [null]);
});
test("pre-aborted requests do not reserve budget or call a model", async () => {
  const f = fixture();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(inferenceResponse(auth, request(), abort.signal, f.deps));
  assert.equal(f.calls.length, 0);
  assert.equal(f.reserved.length, 0);
});
test("an admission failure cannot start upstream inference", async () => {
  const f = fixture();
  f.deps.reserve = async () => {
    throw new Error("quota exceeded");
  };
  await assert.rejects(inferenceResponse(auth, request(), new AbortController().signal, f.deps), /quota/);
  assert.equal(f.calls.length, 0);
});
