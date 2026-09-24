import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";

import { createProviderModel } from "./provider-model.js";
import { assertPublicProviderUrl } from "./provider-url.js";

const prompt: LanguageModelV4CallOptions["prompt"] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];

const provider = {
  id: "provider-id",
  name: "Provider",
  model: "gpt-test",
  responsesDialect: "openai_responses" as const,
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

test("uses the official Responses model while preserving safe body extensions", async () => {
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
    const model = createProviderModel(provider, { parallelToolCalls: true });

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
    assert.deepEqual(requestBody.safe_extension, { enabled: true });
    assert.equal(result.content[0]?.type, "text");
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
    const model = createProviderModel({ ...provider, responsesDialect: "ark_responses" });
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

test("replays DeepSeek reasoning and tool calls without stored-response fields", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      id: "resp_deepseek",
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
  const replayPrompt: LanguageModelV4CallOptions["prompt"] = [
    { role: "user", content: [{ type: "text", text: "ask" }] },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "think", providerOptions: { openai: { itemId: "reasoning_1" } } },
        { type: "tool-call", toolCallId: "call_1", toolName: "ask_user", input: { question: "q" } },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "ask_user",
          output: { type: "text", value: "answer" },
        },
      ],
    },
  ];

  try {
    const model = createProviderModel({ ...provider, responsesDialect: "deepseek_responses" });
    await model.doGenerate({
      prompt: replayPrompt,
      providerOptions: { openai: { previousResponseId: "resp_parent" } },
    });

    assert.equal(requestBody.store, false);
    assert.equal("previous_response_id" in requestBody, false);
    const input = requestBody.input as Array<Record<string, unknown>>;
    assert.deepEqual(
      input.find((item) => item.type === "reasoning")?.content,
      [{ type: "reasoning_text", text: "think" }],
      JSON.stringify(input),
    );
    assert.ok(input.some((item) => item.type === "function_call" && item.call_id === "call_1"));
    assert.ok(input.some((item) => item.type === "function_call_output" && item.call_id === "call_1"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
