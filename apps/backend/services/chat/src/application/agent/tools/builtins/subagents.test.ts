import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import { asSchema, simulateReadableStream, tool, type ToolExecutionOptions, type ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { isToolOutcome, type ToolOutcome } from "../outcome.js";
import { createSubagentsManifest } from "./subagents.js";

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

async function collectExecution(
  manifest: ReturnType<typeof createSubagentsManifest>,
  input: unknown = {
    tasks: [
      {
        id: "evidence",
        task: "Compare primary sources and cite them.",
        context: "Only public evidence is in scope.",
      },
    ],
  },
  signal?: AbortSignal,
) {
  assert.ok(manifest.tool?.execute);
  const result = manifest.tool.execute(input, { ...options, abortSignal: signal });
  assert.ok(result && typeof result === "object" && Symbol.asyncIterator in result);
  const outputs: ToolOutcome[] = [];
  for await (const output of result as AsyncIterable<unknown>) {
    assert.ok(isToolOutcome(output));
    outputs.push(output);
  }
  return outputs;
}

void test("subagents stream isolated progress and return only compressed reports to the parent model", async () => {
  const model = new MockLanguageModelV4({
    doStream: textStream("Evidence-backed report with https://example.com/source"),
  });
  const manifest = createSubagentsManifest({ provider, tools, model });

  const outputs = await collectExecution(manifest);

  assert.ok(outputs.some((output) => output.status === "running"));
  const completed = outputs.at(-1);
  assert.ok(completed?.status === "completed");
  const data = completed.data as { subagents: Array<{ report: string }> };
  assert.equal(data.subagents[0].report, "Evidence-backed report with https://example.com/source");
  assert.deepEqual(model.doStreamCalls[0].tools?.map((candidate) => candidate.name).sort(), [
    "web_fetch",
    "web_search",
  ]);
  assert.match(JSON.stringify(model.doStreamCalls[0].prompt), /Compare primary sources/);
  assert.match(JSON.stringify(model.doStreamCalls[0].prompt), /minimum evidence sufficient/i);
  assert.match(JSON.stringify(model.doStreamCalls[0].prompt), /Do not broaden the scope/i);
  assert.doesNotMatch(JSON.stringify(model.doStreamCalls[0].prompt), /deep research subagent/i);
  assert.equal(model.doStreamCalls[0].prompt.length, 2);
  assert.match(JSON.stringify(model.doStreamCalls[0].prompt[1]), /Only public evidence is in scope/);
  assert.equal(manifest.policy.uiKind, "subagent");

  const modelOutput = await manifest.tool?.toModelOutput?.({ output: completed } as never);
  assert.deepEqual(modelOutput, {
    type: "text",
    value: "## evidence\n\nEvidence-backed report with https://example.com/source",
  });
});

void test("subagents are optional context isolation, not a mandatory research router", () => {
  const manifest = createSubagentsManifest({ provider, tools, model: new MockLanguageModelV4() });
  assert.ok(manifest.tool && "description" in manifest.tool);
  const description = manifest.tool.description;
  assert.equal(typeof description, "string");
  if (typeof description !== "string") return;

  assert.match(description, /fresh disposable context/i);
  assert.match(description, /genuinely independent investigations can run in parallel/i);
  assert.match(description, /Keep work in the primary loop when it is small, sequential/i);
  assert.match(description, /research or a report alone is not a reason to delegate/i);
  assert.doesNotMatch(description, /Prefer this tool whenever/i);
});

void test("subagents accept one to three uniquely identified tasks", async () => {
  const manifest = createSubagentsManifest({ provider, tools, model: new MockLanguageModelV4() });
  assert.ok(manifest.tool && "inputSchema" in manifest.tool);
  const schema = asSchema(manifest.tool.inputSchema);
  const valid = await schema.validate?.({ tasks: [{ id: "one", task: "Research one topic." }] });
  const tooMany = await schema.validate?.({
    tasks: [1, 2, 3, 4].map((id) => ({ id: `task-${id}`, task: `Research topic ${id}.` })),
  });
  const duplicate = await schema.validate?.({
    tasks: [
      { id: "same", task: "Research one topic." },
      { id: "same", task: "Research another topic." },
    ],
  });

  assert.equal(valid?.success, true);
  assert.equal(tooMany?.success, false);
  assert.equal(duplicate?.success, false);
});

void test("subagents run two independent delegated tasks concurrently and return both reports", async () => {
  let active = 0;
  let maxActive = 0;
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      active--;
      const serialized = JSON.stringify(prompt);
      return textStream(serialized.includes("market") ? "Market report" : "Technology report");
    },
  });
  const manifest = createSubagentsManifest({ provider, tools, model });

  const outputs = await collectExecution(manifest, {
    tasks: [
      { id: "market", task: "Research market adoption." },
      { id: "technology", task: "Research the technology architecture." },
    ],
  });

  assert.equal(maxActive, 2);
  const completed = outputs.at(-1);
  assert.ok(completed?.status === "completed");
  const results = (completed.data as { subagents: Array<{ id: string; report: string }> }).subagents;
  assert.deepEqual(
    results.map(({ id, report }) => ({ id, report })),
    [
      { id: "market", report: "Market report" },
      { id: "technology", report: "Technology report" },
    ],
  );
});

void test("subagents preserve successful sibling reports when one task fails", async () => {
  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const serialized = JSON.stringify(prompt);
      if (serialized.includes("market")) return textStream("");
      return textStream("Technology report");
    },
  });
  const manifest = createSubagentsManifest({ provider, tools, model });

  const outputs = await collectExecution(manifest, {
    tasks: [
      { id: "market", task: "Research market adoption." },
      { id: "technology", task: "Research the technology architecture." },
    ],
  });

  const completed = outputs.at(-1);
  assert.ok(completed?.status === "completed");
  const results = (
    completed.data as { subagents: Array<{ id: string; status: string; report?: string; error?: { message: string } }> }
  ).subagents;
  assert.deepEqual(
    results.map(({ id, status, report, error }) => ({ id, status, report, error: error?.message })),
    [
      {
        id: "market",
        status: "failed",
        report: undefined,
        error: "subagent market finished without a final report",
      },
      { id: "technology", status: "completed", report: "Technology report", error: undefined },
    ],
  );
});

void test("subagents retain streamed progress and the underlying provider error when a child fails", async () => {
  const model = new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "partial" },
          { type: "text-delta" as const, id: "partial", delta: "Evidence collected before failure" },
          { type: "text-end" as const, id: "partial" },
          { type: "error" as const, error: new Error("provider continuation rejected") },
        ],
      }),
    },
  });
  const manifest = createSubagentsManifest({ provider, tools, model });

  const outputs = await collectExecution(manifest);
  const completed = outputs.at(-1);
  assert.ok(completed?.status === "completed");
  const [failed] = (
    completed.data as {
      subagents: Array<{
        status: string;
        message?: { parts: Array<{ type: string; text?: string }> };
        error?: { message: string };
      }>;
    }
  ).subagents;
  assert.equal(failed.status, "failed");
  assert.equal(failed.error?.message, "provider continuation rejected");
  assert.equal(failed.message?.parts.find((part) => part.type === "text")?.text, "Evidence collected before failure");
});

void test("subagents bound cumulative child progress instead of publishing every growing snapshot", async () => {
  const delta = "e".repeat(1_024);
  const model = new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "report" },
          ...Array.from({ length: 200 }, () => ({ type: "text-delta" as const, id: "report", delta })),
          { type: "text-end" as const, id: "report" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: {
              inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 51_200, text: 51_200, reasoning: 0 },
            },
          },
        ],
      }),
    },
  });
  const manifest = createSubagentsManifest({ provider, tools, model });

  const outputs = await collectExecution(manifest);
  const running = outputs.filter((output) => output.status === "running");

  assert.ok(running.length <= 65, `expected at most 65 running snapshots, received ${running.length}`);
  assert.ok(
    running.every((output) => Buffer.byteLength(JSON.stringify(output), "utf8") <= 24 * 1_024),
    "running snapshots must remain compact instead of carrying the cumulative report",
  );
  const completed = outputs.at(-1);
  assert.ok(completed?.status === "completed");
  assert.equal(
    (completed.data as { subagents: Array<{ report: string }> }).subagents[0].report.length,
    200 * delta.length,
  );
});

void test("subagents propagate cancellation through every child agent", async () => {
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      abortSignal?.throwIfAborted();
      return textStream("unreachable");
    },
  });
  const manifest = createSubagentsManifest({ provider, tools, model });
  const signal = AbortSignal.abort(new DOMException("Stopped", "AbortError"));

  await assert.rejects(() => collectExecution(manifest, undefined, signal), { name: "AbortError" });
});
