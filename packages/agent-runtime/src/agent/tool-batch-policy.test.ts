import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelV4Content } from "@ai-sdk/provider";

import { filterToolBatch } from "./tool-batch-policy.js";

function call(toolCallId: string, toolName: string): LanguageModelV4Content {
  return { type: "tool-call", toolCallId, toolName, input: "{}" };
}

test("retains independent ordinary tool calls from one model response", () => {
  const content = [call("call_search", "web_search"), call("call_fetch", "web_fetch")];

  assert.deepEqual(filterToolBatch("normal", content), content);
});

test("keeps load_skill as a batch barrier", () => {
  const loadSkill = call("call_skill", "load_skill");

  assert.deepEqual(filterToolBatch("normal", [loadSkill, call("call_fetch", "web_fetch")]), [loadSkill]);
});
