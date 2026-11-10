import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import { simulateReadableStream, tool, type ToolExecutionOptions, type ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { isToolOutcome, type ToolOutcome } from "../outcome.js";
import { createResearchSubagentManifest } from "./research.js";

const provider: LanguageProviderSnapshot = {
  id: "provider",
  name: "Provider",
  model: "research-model",
  responsesDialect: "openai_responses",
  baseUrl: "https://example.com/v1",
  apiKey: "test",
  extraBody: {},
  contextWindow: 128_000,
  maxOutputTokens: 4_096,
};

const tools = {
  web_search: tool({
    description: "Search public sources",
    inputSchema: z.object({ query: z.string() }),
    execute: async () => ({ results: [] }),
  }),
  web_fetch: tool({
    description: "Fetch a source",
    inputSchema: z.object({ url: z.string() }),
    execute: async () => ({ content: "source" }),
  }),
} satisfies ToolSet;

const options: ToolExecutionOptions<{ runId: string }> = {
  toolCallId: "parent-tool-call",
  messages: [],
  context: { runId: "run-id" },
};

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

async function collectExecution(manifest: ReturnType<typeof createResearchSubagentManifest>, signal?: AbortSignal) {
  assert.ok(manifest.tool?.execute);
  const result = manifest.tool.execute(
    { task: "Compare primary sources and cite them.", context: "Only public evidence is in scope." },
    { ...options, abortSignal: signal },
  );
  assert.ok(result && typeof result === "object" && Symbol.asyncIterator in result);
  const outputs: ToolOutcome[] = [];
  for await (const output of result as AsyncIterable<unknown>) {
    assert.ok(isToolOutcome(output));
    outputs.push(output);
  }
  return outputs;
}

void test("research streams isolated progress and returns only its final report to the parent model", async () => {
  const model = new MockLanguageModelV4({
    doStream: textStream("Evidence-backed report with https://example.com/source"),
  });
  const manifest = createResearchSubagentManifest({ provider, tools, model });

  const outputs = await collectExecution(manifest);

  assert.ok(outputs.some((output) => output.status === "running"));
  const completed = outputs.at(-1);
  assert.ok(completed?.status === "completed");
  assert.equal((completed.data as { report: string }).report, "Evidence-backed report with https://example.com/source");
  assert.deepEqual(model.doStreamCalls[0].tools?.map((candidate) => candidate.name).sort(), [
    "web_fetch",
    "web_search",
  ]);
  assert.match(JSON.stringify(model.doStreamCalls[0].prompt), /Compare primary sources/);
  assert.equal(model.doStreamCalls[0].prompt.length, 2);
  assert.match(JSON.stringify(model.doStreamCalls[0].prompt[1]), /Only public evidence is in scope/);
  assert.equal(manifest.policy.uiKind, "subagent");

  const modelOutput = await manifest.tool?.toModelOutput?.({ output: completed } as never);
  assert.deepEqual(modelOutput, {
    type: "text",
    value: "Evidence-backed report with https://example.com/source",
  });
});

void test("research propagates cancellation through the child agent", async () => {
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      abortSignal?.throwIfAborted();
      return textStream("unreachable");
    },
  });
  const manifest = createResearchSubagentManifest({ provider, tools, model });
  const signal = AbortSignal.abort(new DOMException("Stopped", "AbortError"));

  await assert.rejects(() => collectExecution(manifest, signal), { name: "AbortError" });
});
