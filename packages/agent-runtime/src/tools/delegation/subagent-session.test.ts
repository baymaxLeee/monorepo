import assert from "node:assert/strict";
import test from "node:test";

import { simulateReadableStream, tool, type ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { createSubagentSessionRunner } from "./subagent-session.js";

const limits = { contextWindow: 32_000, maxOutputTokens: 4_096 };
const model = new MockLanguageModelV4();

function textStream(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id: "text" },
        { type: "text-delta" as const, id: "text", delta: text },
        { type: "text-end" as const, id: "text" },
        {
          type: "finish" as const,
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 7, text: 7, reasoning: 0 },
          },
        },
      ],
    }),
  };
}

function createRunner(input: { model: MockLanguageModelV4; tools?: ToolSet; maxSteps?: number }) {
  return createSubagentSessionRunner({
    modelName: "research-model",
    model: input.model,
    instructions: "Research and return a concise report.",
    tools: input.tools ?? {},
    toolsContext: {},
    contextLimits: limits,
    maxOutputTokens: limits.maxOutputTokens,
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
  });
}

test("subagent sessions reject client and approval tools", () => {
  assert.throws(
    () =>
      createRunner({
        model,
        tools: { ask_user: tool({ description: "Ask", inputSchema: z.object({}) }) },
      }),
    /must execute automatically/,
  );
  assert.throws(
    () =>
      createRunner({
        model,
        tools: {
          write: tool({
            description: "Write",
            inputSchema: z.object({}),
            needsApproval: true,
            execute: async () => "written",
          }),
        },
      }),
    /cannot require approval/,
  );
});

test("subagent sessions require a bounded run with a final report step", () => {
  assert.throws(() => createRunner({ model, maxSteps: 1 }), /at least 2/);
});

test("subagent sessions retry only the interrupted sample without repeating completed tools", async () => {
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
      return textStream("Recovered report");
    },
  });
  const runner = createRunner({
    model: retryingModel,
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
  });

  const result = await runner.run({ id: "retry", prompt: "Research this.", onSnapshot: () => {} });

  assert.equal(result.message.parts.find((part) => part.type === "text")?.text, "Recovered report");
  assert.equal(modelCalls, 3);
  assert.equal(toolExecutions, 1);
});

test("subagent sessions compact large tool results inside the child before the next sample", async () => {
  const privateEvidence = `PRIVATE_TOOL_TRACE_${"x".repeat(40_000)}`;
  let toolExecutions = 0;
  let ordinarySamples = 0;
  let compactionSamples = 0;
  const compactingModel = new MockLanguageModelV4({
    doStream: async (options) => {
      const serialized = JSON.stringify(options.prompt);
      if (serialized.includes("Compress the older transcript prefix")) {
        compactionSamples++;
        assert.match(serialized, /PRIVATE_TOOL_TRACE_/);
        return textStream("The source was fetched and its relevant evidence was retained.");
      }
      ordinarySamples++;
      if (ordinarySamples === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              {
                type: "tool-call" as const,
                toolCallId: "large-fetch",
                toolName: "web_fetch",
                input: JSON.stringify({ url: "https://example.com" }),
              },
              {
                type: "finish" as const,
                finishReason: { unified: "tool-calls" as const, raw: undefined },
                usage: {
                  inputTokens: { total: 8, noCache: 8, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 3, text: 3, reasoning: 0 },
                },
              },
            ],
          }),
        };
      }
      assert.match(serialized, /compacted_history/);
      assert.doesNotMatch(serialized, /PRIVATE_TOOL_TRACE_/);
      return textStream("Bounded final report");
    },
  });
  const runner = createSubagentSessionRunner({
    modelName: "research-model",
    model: compactingModel,
    instructions: "Research and report.",
    tools: {
      web_fetch: tool({
        description: "Fetch",
        inputSchema: z.object({ url: z.string() }),
        execute: async () => {
          toolExecutions++;
          return { content: privateEvidence };
        },
      }),
    },
    toolsContext: {},
    contextLimits: { contextWindow: 32_000, maxOutputTokens: 4_096, autoCompactTokenLimit: 1_000 },
    maxOutputTokens: 4_096,
  });

  const result = await runner.run({ id: "compact", prompt: "Research this.", onSnapshot: () => {} });

  assert.equal(result.message.parts.find((part) => part.type === "text")?.text, "Bounded final report");
  assert.equal(toolExecutions, 1);
  assert.equal(compactionSamples, 1);
  assert.equal(ordinarySamples, 2);
});
