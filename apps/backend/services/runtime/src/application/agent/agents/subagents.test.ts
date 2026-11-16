import assert from "node:assert/strict";
import test from "node:test";

import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { createSubagent } from "./subagents.js";

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
        supportsStoredContinuation: false,
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
        supportsStoredContinuation: false,
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
        supportsStoredContinuation: false,
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
    supportsStoredContinuation: true,
  });

  const result = await child.stream({ prompt: "Research this." });
  let streamError: unknown;
  for await (const chunk of result.fullStream) {
    if (chunk.type === "error") streamError = chunk.error;
  }
  assert.equal(streamError, undefined);
  assert.equal(call, 2);
});
