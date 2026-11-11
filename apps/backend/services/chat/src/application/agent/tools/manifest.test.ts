import assert from "node:assert/strict";
import test from "node:test";

import {
  experimental_getToolCaller as getToolCaller,
  experimental_toolCaller as toolCaller,
} from "@ai-sdk/provider-utils";
import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { defineAgentTool } from "./manifest.js";
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
      modes: ["normal"],
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
