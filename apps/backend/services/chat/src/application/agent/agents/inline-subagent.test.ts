import assert from "node:assert/strict";
import test from "node:test";

import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { createInlineSubagent } from "./inline-subagent.js";

const model = new MockLanguageModelV4();

void test("inline subagents reject client and approval tools", () => {
  assert.throws(
    () =>
      createInlineSubagent({
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
      createInlineSubagent({
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

void test("inline subagents require a bounded run with a final report step", () => {
  assert.throws(
    () =>
      createInlineSubagent({
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
