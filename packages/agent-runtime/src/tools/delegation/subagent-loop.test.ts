import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { simulateReadableStream, tool, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import type { StoredModelContinuation } from "../../turn/model-capabilities.js";
import { createSubagent } from "./subagent-loop.js";

const storedContinuation: StoredModelContinuation = {
  prepareStatelessCall: (params: LanguageModelV4CallOptions) => params,
  prepareCall: () => null,
  prepareStep: (messages: ModelMessage[], previousResponseId: string) => ({
    messages,
    providerOptions: { openai: { previousResponseId } },
  }),
  responseId: (event: { providerMetadata?: unknown; response: { id?: string } }) => {
    const metadata = event.providerMetadata as { openai?: { responseId?: unknown } } | undefined;
    return typeof metadata?.openai?.responseId === "string" ? metadata.openai.responseId : (event.response.id ?? null);
  },
};

const model = new MockLanguageModelV4();

void test("subagents reject client and approval tools", () => {
  assert.throws(
    () =>
      createSubagent({
        id: "client-tool",
        model,
        instructions: "test",
        tools: { ask_user: tool({ description: "Ask", inputSchema: z.object({}) }) },
        toolsContext: {},
      }),
    /must execute automatically/,
  );
  assert.throws(
    () =>
      createSubagent({
        id: "approval-tool",
        model,
        instructions: "test",
        tools: {
          write: tool({
            description: "Write",
            inputSchema: z.object({}),
            needsApproval: true,
            execute: async () => "written",
          }),
        },
        toolsContext: {},
      }),
    /cannot require approval/,
  );
});

void test("subagents require a bounded run with a final report step", () => {
  assert.throws(
    () =>
      createSubagent({
        id: "invalid-budget",
        model,
        instructions: "test",
        tools: {},
        toolsContext: {},
        maxSteps: 1,
      }),
    /at least 2/,
  );
});

void test("subagents continue stored Responses runs with only new tool results", async () => {
  let call = 0;
  const storedModel = new MockLanguageModelV4({
    doStream: async (options) => {
      call++;
      if (call === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              { type: "response-metadata" as const, id: "response-1" },
              {
                type: "tool-call" as const,
                toolCallId: "fetch-1",
                toolName: "web_fetch",
                input: JSON.stringify({ url: "https://example.com" }),
              },
              {
                type: "finish" as const,
                finishReason: { unified: "tool-calls" as const, raw: undefined },
                usage: {
                  inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 2, text: 2, reasoning: 0 },
                },
              },
            ],
          }),
        };
      }

      assert.equal(
        (options.providerOptions?.openai as { previousResponseId?: string } | undefined)?.previousResponseId,
        "response-1",
      );
      assert.deepEqual(
        options.prompt.filter((message) => message.role !== "system").map((message) => message.role),
        ["tool"],
      );
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "report" },
            { type: "text-delta" as const, id: "report", delta: "Sourced report" },
            { type: "text-end" as const, id: "report" },
            {
              type: "finish" as const,
              finishReason: { unified: "stop" as const, raw: undefined },
              usage: {
                inputTokens: { total: 6, noCache: 6, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 3, text: 3, reasoning: 0 },
              },
            },
          ],
        }),
      };
    },
  });
  const child = createSubagent({
    id: "stored-response",
    model: storedModel,
    instructions: "Research and report.",
    tools: {
      web_fetch: tool({
        description: "Fetch",
        inputSchema: z.object({ url: z.string() }),
        execute: async () => ({ content: "evidence" }),
      }),
    },
    toolsContext: {},
    continuation: storedContinuation,
  });

  const result = await child.stream({ prompt: "Research this." });
  let streamError: unknown;
  for await (const chunk of result.fullStream) {
    if (chunk.type === "error") streamError = chunk.error;
  }
  assert.equal(streamError, undefined);
  assert.equal(call, 2);
});

void test("subagents retry only the interrupted model call without repeating completed tools", async () => {
  let modelCalls = 0;
  let toolExecutions = 0;
  const retryingModel = new MockLanguageModelV4({
    doStream: async () => {
      modelCalls++;
      if (modelCalls === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              {
                type: "tool-call" as const,
                toolCallId: "fetch-once",
                toolName: "web_fetch",
                input: JSON.stringify({ url: "https://example.com" }),
              },
              {
                type: "finish" as const,
                finishReason: { unified: "tool-calls" as const, raw: undefined },
                usage: {
                  inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 2, text: 2, reasoning: 0 },
                },
              },
            ],
          }),
        };
      }
      if (modelCalls === 2) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              {
                type: "tool-call" as const,
                toolCallId: "discarded-fetch",
                toolName: "web_fetch",
                input: JSON.stringify({ url: "https://discarded.example.com" }),
              },
              {
                type: "error" as const,
                error: Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
              },
            ],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "report" },
            { type: "text-delta" as const, id: "report", delta: "Recovered report" },
            { type: "text-end" as const, id: "report" },
            {
              type: "finish" as const,
              finishReason: { unified: "stop" as const, raw: undefined },
              usage: {
                inputTokens: { total: 6, noCache: 6, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 3, text: 3, reasoning: 0 },
              },
            },
          ],
        }),
      };
    },
  });
  const child = createSubagent({
    id: "retry-current-model-call",
    model: retryingModel,
    instructions: "Research and report.",
    tools: {
      web_fetch: tool({
        description: "Fetch",
        inputSchema: z.object({ url: z.string() }),
        execute: async () => {
          toolExecutions++;
          return { content: "evidence" };
        },
      }),
    },
    toolsContext: {},
  });

  const result = await child.stream({ prompt: "Research this." });
  await result.consumeStream();

  assert.equal(modelCalls, 3);
  assert.equal(toolExecutions, 1);
});
