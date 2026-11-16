import assert from "node:assert/strict";
import test from "node:test";

import { generateText, isStepCount, tool, type ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { createToolSearchManifest } from "./discovery.js";
import { manifestsToTools } from "./manifest.js";

test("native tool search discovers deferred tools without activating excluded tools", async () => {
  const deferred = tool({
    description: "Read a public page",
    deferLoading: true,
    inputSchema: z.object({}),
    execute: async () => "page",
  });
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content:
        model.doGenerateCalls.length === 1
          ? [{ type: "tool-call", toolCallId: "search", toolName: "tool_search", input: '{"query":"public page"}' }]
          : [{ type: "text", text: "done" }],
      finishReason: { unified: model.doGenerateCalls.length === 1 ? "tool-calls" : "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
  const tools: ToolSet = { ...manifestsToTools([createToolSearchManifest()]), web_fetch: deferred, excluded: deferred };
  const result = await generateText({
    model,
    tools,
    activeTools: ["tool_search", "web_fetch"],
    prompt: "Find a tool to read a public page",
    stopWhen: isStepCount(2),
  });
  assert.deepEqual(
    model.doGenerateCalls[0].tools?.map((item) => item.name),
    ["tool_search"],
  );
  assert.deepEqual(model.doGenerateCalls[1].tools?.map((item) => item.name).sort(), ["tool_search", "web_fetch"]);
  assert.deepEqual(result.steps[0].toolResults[0].output, {
    tools: [{ name: "web_fetch", description: "Read a public page" }],
  });
});
