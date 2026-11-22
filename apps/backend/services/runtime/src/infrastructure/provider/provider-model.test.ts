import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { projectRuntimeContext, type RuntimeContextCheckpointWrite } from "@repo/agent-runtime";
import { streamText } from "ai";

import { createProviderModel } from "./provider-model.js";
import { assertPublicProviderUrl } from "./provider-url.js";

const prompt: LanguageModelV4CallOptions["prompt"] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];

const provider = {
  id: "provider-id",
  name: "Provider",
  model: "gpt-test",
  baseUrl: "https://8.8.8.8/responses",
  apiKey: "secret",
  extraBody: { safe_extension: { enabled: true }, model: "must-not-win", stream: false },
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
};

test("rejects local and reserved provider addresses before fetch", async () => {
  await assert.rejects(assertPublicProviderUrl("http://localhost/v1"), /public host/);
  await assert.rejects(assertPublicProviderUrl("http://127.0.0.1/v1"), /private or reserved/);
  await assert.rejects(assertPublicProviderUrl("http://[::1]/v1"), /private or reserved/);
});

test("uses the Ark Responses contract while preserving safe body extensions", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestUrl = input instanceof Request ? input.url : input.toString();
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      id: "resp_test",
      object: "response",
      created_at: 1_700_000_000,
      model: "gpt-test",
      status: "completed",
      incomplete_details: null,
      output: [
        {
          type: "message",
          id: "msg_test",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
  };

  try {
    const model = createProviderModel(provider, {
      parallelToolCalls: true,
    });

    const result = await model.doGenerate({
      prompt,
      providerOptions: { openai: { previousResponseId: "resp_parent", parallelToolCalls: false } },
    });

    assert.equal(requestUrl, "https://8.8.8.8/responses");
    assert.equal(requestBody.model, "gpt-test");
    assert.equal("stream" in requestBody, false);
    assert.equal(requestBody.store, true);
    assert.equal(requestBody.previous_response_id, "resp_parent");
    assert.equal(requestBody.parallel_tool_calls, false);
    assert.equal("context_management" in requestBody, false);
    assert.deepEqual(requestBody.safe_extension, { enabled: true });
    assert.equal(result.content[0]?.type, "text");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses Ark stored continuation semantics for every configured chat model", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({
      id: "resp_continued",
      object: "response",
      created_at: 1_700_000_000,
      model: "gpt-test",
      status: "completed",
      incomplete_details: null,
      output: [
        {
          type: "message",
          id: "msg_continued",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "done" }],
        },
      ],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
  };
  const continuationPrompt: LanguageModelV4CallOptions["prompt"] = [
    { role: "system", content: "Follow the agent contract." },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "code_mode",
          output: { type: "text", value: "result" },
        },
      ],
    },
  ];

  try {
    const model = createProviderModel(provider);
    await model.doGenerate({
      prompt: continuationPrompt,
      providerOptions: { openai: { previousResponseId: "resp_parent" } },
    });

    assert.equal(requestBodies.length, 1);
    for (const body of requestBodies) {
      assert.equal(body.store, true);
      assert.equal(body.previous_response_id, "resp_parent");
      assert.equal(body.instructions, "Follow the agent contract.");
      assert.deepEqual(body.input, [{ type: "function_call_output", call_id: "call_1", output: "result" }]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("materializes Ark prompt content when no stored response lineage is available", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      id: "resp_rebuilt",
      object: "response",
      created_at: 1_700_000_000,
      model: "gpt-test",
      status: "completed",
      incomplete_details: null,
      output: [
        {
          type: "message",
          id: "msg_rebuilt",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "done" }],
        },
      ],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
  };

  const rebuiltPrompt: LanguageModelV4CallOptions["prompt"] = [
    { role: "user", content: [{ type: "text", text: "research this" }] },
    {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "I should search first.",
          providerOptions: { openai: { itemId: "rs_stored", reasoningEncryptedContent: null } },
        },
        {
          type: "tool-call",
          toolCallId: "call_search",
          toolName: "web_search",
          input: { query: "current result" },
          providerOptions: { openai: { itemId: "fc_stored" } },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_search",
          toolName: "web_search",
          output: { type: "json", value: { results: [] } },
        },
      ],
    },
  ];

  try {
    const model = createProviderModel(provider);
    await model.doGenerate({ prompt: rebuiltPrompt });

    assert.doesNotMatch(JSON.stringify(requestBody.input), /item_reference|rs_stored|fc_stored/);
    assert.match(JSON.stringify(requestBody.input), /research this|web_search|call_search/);
    assert.equal(requestBody.store, true);
    assert.equal("previous_response_id" in requestBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("removes caller-supplied context management from Ark requests", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({
      id: "resp_parallel",
      object: "response",
      created_at: 1_700_000_000,
      model: "gpt-test",
      status: "completed",
      incomplete_details: null,
      output: [
        {
          type: "message",
          id: "msg_parallel",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
  };

  try {
    const model = createProviderModel(provider, { parallelToolCalls: true });
    await model.doGenerate({
      prompt,
      providerOptions: {
        openai: { contextManagement: [{ type: "compaction", compactThreshold: 123 }] },
      },
    });

    assert.equal(requestBodies.length, 1);
    for (const body of requestBodies) {
      assert.equal(body.parallel_tool_calls, true);
      assert.equal("context_management" in body, false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizes reasoning_text SSE while preserving official text annotations", async () => {
  const originalFetch = globalThis.fetch;
  const events = [
    {
      type: "response.created",
      response: { id: "resp_stream", created_at: 1_700_000_000, model: "gpt-test" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "reasoning", id: "reasoning_1", encrypted_content: null },
    },
    {
      type: "response.content_part.added",
      item_id: "reasoning_1",
      output_index: 0,
      content_index: 0,
      part: { type: "reasoning_text", text: "" },
    },
    {
      type: "response.reasoning_text.delta",
      item_id: "reasoning_1",
      output_index: 0,
      content_index: 0,
      delta: "think",
    },
    {
      type: "response.reasoning_text.done",
      item_id: "reasoning_1",
      output_index: 0,
      content_index: 0,
      text: "think",
    },
    {
      type: "response.content_part.done",
      item_id: "reasoning_1",
      output_index: 0,
      content_index: 0,
      part: { type: "reasoning_text", text: "think" },
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "reasoning", id: "reasoning_1", encrypted_content: null },
    },
    {
      type: "response.output_item.added",
      output_index: 1,
      item: { type: "message", id: "message_1", phase: "final_answer" },
    },
    {
      type: "response.output_text.delta",
      item_id: "message_1",
      output_index: 1,
      content_index: 0,
      delta: "answer",
    },
    {
      type: "response.output_text.annotation.added",
      annotation: {
        type: "url_citation",
        start_index: 0,
        end_index: 6,
        url: "https://example.com/source",
        title: "Source",
      },
    },
    {
      type: "response.output_item.done",
      output_index: 1,
      item: { type: "message", id: "message_1", phase: "final_answer" },
    },
    {
      type: "response.completed",
      response: { incomplete_details: null, usage: null, reasoning: null, service_tier: null },
    },
  ];

  globalThis.fetch = async () =>
    new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
      headers: { "content-type": "text/event-stream" },
    });

  try {
    const model = createProviderModel(provider);
    const result = await model.doStream({ prompt });
    const parts = [];
    for await (const part of result.stream) {
      parts.push(part);
    }

    assert.ok(parts.some((part) => part.type === "reasoning-delta" && part.delta === "think"));
    assert.ok(parts.some((part) => part.type === "reasoning-end"));
    assert.ok(parts.some((part) => part.type === "text-delta" && part.delta === "answer"));
    assert.ok(
      parts.some(
        (part) =>
          part.type === "text-end" && JSON.stringify(part.providerMetadata).includes("https://example.com/source"),
      ),
    );
    assert.equal(
      parts.some((part) => part.type === "error"),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizes Ark function_call added events that omit arguments", async () => {
  const originalFetch = globalThis.fetch;
  const events = [
    {
      type: "response.created",
      response: { id: "resp_ark", created_at: 1_700_000_000, model: "gpt-test" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "ask_user", status: "in_progress" },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: "fc_1",
      output_index: 0,
      delta: "{}",
    },
    {
      type: "response.function_call_arguments.done",
      item_id: "fc_1",
      output_index: 0,
      arguments: "{}",
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "ask_user",
        arguments: "{}",
        status: "completed",
      },
    },
    {
      type: "response.completed",
      response: { incomplete_details: null, usage: null, reasoning: null, service_tier: null },
    },
  ];
  globalThis.fetch = async () =>
    new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
      headers: { "content-type": "text/event-stream" },
    });

  try {
    const model = createProviderModel(provider);
    const result = await model.doStream({ prompt });
    const parts = [];
    for await (const part of result.stream) {
      parts.push(part);
    }

    assert.ok(parts.some((part) => part.type === "tool-input-start" && part.toolName === "ask_user"));
    assert.equal(
      parts.some((part) => part.type === "error"),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses compaction checkpoints round-trip through the installed SDK and expire on model change", async (t) => {
  const requests: Record<string, unknown>[] = [];
  const compactItem = { type: "compaction", id: "cmp_1", encrypted_content: "sealed" };
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const events = [
      { type: "response.created", response: { id: "resp_1", created_at: 1700000000, model: "gpt-test" } },
      { type: "response.output_item.done", output_index: 0, item: compactItem },
      {
        type: "response.completed",
        response: { incomplete_details: null, usage: null, reasoning: null, service_tier: null },
      },
    ];
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
      headers: { "content-type": "text/event-stream" },
    });
  });
  const model = createProviderModel(provider);
  const messages = ["a".repeat(2000), "continue here"].map((text, i) => ({
    id: String(i),
    role: "user" as const,
    parts: [{ type: "text" as const, text }],
  }));
  let saved: RuntimeContextCheckpointWrite | undefined;
  const projection = {
    messages,
    model,
    limits: { contextWindow: 10000, maxOutputTokens: 1000, autoCompactTokenLimit: 512 },
    remoteBinding: "provider/model",
    saveCheckpoint: async (next: RuntimeContextCheckpointWrite) => {
      saved = next;
    },
  };
  const first = await projectRuntimeContext({ ...projection, checkpoint: null });
  assert.equal(first.checkpointAdvanced, true);
  assert.ok(saved);
  assert.deepEqual(saved.state, {
    version: "responses-compaction-v2",
    binding: "provider/model",
    itemId: "cmp_1",
    encryptedContent: "sealed",
  });
  assert.equal(requests[0]?.store, false);
  assert.deepEqual((requests[0].input as unknown[]).at(-1), { type: "compaction_trigger" });
  const checkpoint = { ...saved, revision: 1 };
  const next = await projectRuntimeContext({ ...projection, checkpoint });
  assert.deepEqual(next.messages, first.messages);
  assert.equal(requests.length, 1);
  await streamText({ model, messages: next.messages, providerOptions: { openai: { store: false } } }).consumeStream();
  assert.deepEqual((requests[1].input as unknown[])[0], compactItem);
  assert.doesNotMatch(JSON.stringify(requests[1]), /compaction_trigger|previous_response_id/);
  const switched = await projectRuntimeContext({
    ...projection,
    remoteBinding: "another/model",
    checkpoint,
    limits: { contextWindow: 128000, maxOutputTokens: 1000 },
  });
  assert.match(JSON.stringify(switched.messages), /a{2000}/);
  assert.doesNotMatch(JSON.stringify(switched.messages), /sealed|cmp_1/);
});
