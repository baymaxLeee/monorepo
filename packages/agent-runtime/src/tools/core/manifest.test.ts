import assert from "node:assert/strict";
import test from "node:test";

import {
  experimental_getToolCaller as getToolCaller,
  experimental_toolCaller as toolCaller,
} from "@ai-sdk/provider-utils";
import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { defineAgentTool, defineUnavailableCapability, manifestsToTools } from "./manifest.js";
import { isToolOutcome } from "./outcome.js";

const options = { toolCallId: "manifest-test", messages: [], context: undefined };

void test("manifest wrapping preserves local tool callers and wraps their bound results", async () => {
  const caller = toolCaller(
    tool({
      inputSchema: z.object({ js: z.string() }),
      execute: async () => "unbound",
    }),
    {
      type: "local",
      bind: () =>
        tool({
          inputSchema: z.object({ js: z.string() }),
          execute: async () => 42,
        }),
      prepareModelMessage: () => "catalog",
    },
  );
  const manifest = defineAgentTool(
    "caller",
    caller,
    {
      capability: "search",
      effect: "read",
      trust: "open-world",
      execution: "inline",
    },
    { summary: "Test caller." },
  );

  const preserved = getToolCaller(manifest.tool);
  assert.equal(preserved?.type, "local");
  assert.ok(preserved?.type === "local");
  assert.equal(preserved.prepareModelMessage?.({}), "catalog");
  const bound = preserved.bind({});
  assert.ok(bound.execute);
  const result = await bound.execute({ js: "return 42" }, options as ToolExecutionOptions<unknown>);
  assert.ok(isToolOutcome(result));
  assert.deepEqual(result, { ok: true, status: "completed", data: 42 });
});

test("tool conversion rejects duplicate manifest names", () => {
  const manifest = defineUnavailableCapability(
    "duplicate",
    { capability: "external", effect: "none", trust: "closed", execution: "inline" },
    { summary: "Duplicate test capability." },
  );

  assert.throws(() => manifestsToTools([manifest, manifest]), /duplicate agent tool duplicate/);
});

test("read tools retry transient network failures while write tools never replay", async () => {
  let readCalls = 0;
  const read = defineAgentTool(
    "read-network",
    tool({
      inputSchema: z.object({}),
      execute: async () => {
        readCalls++;
        if (readCalls === 1) throw Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
        return "recovered";
      },
    }),
    { capability: "external", effect: "read", trust: "open-world", execution: "inline" },
    { summary: "Read network state." },
  );
  const readResult = await read.tool!.execute!({}, options as ToolExecutionOptions<unknown>);
  assert.equal(readCalls, 2);
  assert.deepEqual(readResult, { ok: true, status: "completed", data: "recovered" });

  let writeCalls = 0;
  const write = defineAgentTool(
    "write-network",
    tool({
      inputSchema: z.object({}),
      execute: async (): Promise<string> => {
        writeCalls++;
        throw Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
      },
    }),
    { capability: "external", effect: "write", trust: "open-world", execution: "inline" },
    { summary: "Write network state." },
  );
  const writeResult = await write.tool!.execute!({}, options as ToolExecutionOptions<unknown>);
  assert.equal(writeCalls, 1);
  assert.ok(isToolOutcome(writeResult) && writeResult.status === "failed");
});
