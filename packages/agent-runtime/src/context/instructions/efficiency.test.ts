import assert from "node:assert/strict";
import test from "node:test";

import { tool } from "ai";
import { z } from "zod";

import { defineAgentTool } from "../../tools/manifest.js";
import { assembleInstructions } from "./assembler.js";
import { CORE_POLICY } from "./core-policy.js";
import { USER_UPDATES } from "./user-updates.js";

test("run-level instructions contain invariants instead of product workflows", () => {
  const instructions = assembleInstructions({ memories: [] });

  assert.ok(CORE_POLICY.length < 1_200);
  assert.match(instructions, /continue until the request is handled or genuinely blocked/i);
  assert.match(instructions, /smallest sufficient next action/i);
  assert.doesNotMatch(
    instructions,
    /ECharts|generate_images|create_video_production|update_plan|step_protocol|bash|ask_user|read_file|apply_patch/i,
  );
});

test("multi-step turns receive Codex-style user update instructions", () => {
  const instructions = assembleInstructions({ memories: [] });

  assert.ok(USER_UPDATES.length < 2_000);
  assert.match(instructions, /<user_updates>/);
  assert.match(instructions, /before the first tool call/i);
  assert.match(instructions, /one to three substantive execution steps/i);
  assert.match(instructions, /six execution steps or ten tool calls/i);
  assert.match(instructions, /what you learned or completed/i);
  assert.match(instructions, /before the next tool call in the same response/i);
  assert.match(instructions, /updates are not final answers/i);
  assert.doesNotMatch(USER_UPDATES, /web_search|code_mode|subagents|bash|apply_patch/i);
});

test("tool-specific prerequisites and constraints ship with the tool declaration", () => {
  const manifest = defineAgentTool(
    "publish",
    tool({ description: "Publish a finished file.", inputSchema: z.object({}) }),
    { capability: "files", effect: "add", trust: "closed", execution: "inline" },
    {
      summary: "Publish output.",
      prerequisites: ["Validate the file first."],
      constraints: ["Publish only requested deliverables."],
    },
  );

  const description = manifest.tool?.description;
  assert.equal(typeof description, "string");
  if (typeof description !== "string") {
    throw new TypeError("expected a static tool description");
  }
  assert.match(description, /Prerequisite: Validate the file first/);
  assert.match(description, /Constraint: Publish only requested deliverables/);
  assert.doesNotMatch(assembleInstructions({ memories: [] }), /Validate the file first/);
});
