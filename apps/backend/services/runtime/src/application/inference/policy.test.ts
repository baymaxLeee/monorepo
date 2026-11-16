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
  agentId: null,
  model: "authorized",
  options: {
    prompt: [{ role: "user", content: [{ type: "text", text: "local file contents" }] }],
    maxOutputTokens: 100,
  },
});
function fixture(parts: LanguageModelV4StreamPart[] = [finish], contextWindow = 10_000) {
  const charges: (number | null)[] = [],
    calls: LanguageModelV4CallOptions[] = [],
    reserved: number[] = [];
  let cancelled = false;
  const deps: RelayDependencies = {
    resolve: async () => ({
      config: {
        agentId: null,
        agentName: "test",
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
          return {
            stream: new ReadableStream({
              start(controller) {
                for (const part of parts) controller.enqueue(part);
                controller.close();
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
test("missing finish and provider tool execution fail without retry and keep the reservation", async () => {
  for (const parts of [
    [],
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
    await assert.rejects(response.text());
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.charges, [null]);
  }
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
