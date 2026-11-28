import assert from "node:assert/strict";
import test from "node:test";

import { tool } from "ai";
import { z } from "zod";

import { defineAgentTool } from "../../tools/core/manifest.js";
import { assembleInstructions } from "./assembler.js";
import { CORE_POLICY } from "./core-policy.js";
import { buildInstructionPlan } from "./plan.js";

test("run-level instructions contain invariants instead of product workflows", () => {
  const instructions = assembleInstructions({ memories: [] });

  assert.ok(CORE_POLICY.length > 5_000);
  assert.match(instructions, /until their intended goal is completely handled/i);
  assert.match(instructions, /take end-to-end ownership/i);
  assert.doesNotMatch(
    instructions,
    /ECharts|generate_images|create_video_production|update_plan|step_protocol|bash|ask_user|read_file|apply_patch/i,
  );
});

test("multi-step turns receive user update instructions", () => {
  const instructions = assembleInstructions({ memories: [] });

  assert.match(instructions, /## Intermediate commentary/);
  assert.match(instructions, /requires calling tools, start with a message/i);
  assert.match(instructions, /consistent, frequent communication/i);
  assert.match(instructions, /sleep for as long as is required/i);
  assert.match(instructions, /assumptions, findings, decisions/i);
  assert.match(instructions, /Do NOT send user-facing questions in intermediate commentary/i);
  assert.match(instructions, /final answer must always be fully self-contained/i);
  assert.doesNotMatch(CORE_POLICY, /web_search|code_mode|subagents|apply_patch/i);
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

test("instruction plans keep stable policy before replaceable world-state sections", () => {
  const first = buildInstructionPlan({
    modelInstructions: "Model baseline",
    input: { memories: [], now: new Date("2026-11-28T00:00:00Z") },
    contributions: { skills: [{ name: "research", description: "Search sources" }] },
  });
  const second = buildInstructionPlan({
    modelInstructions: "Model baseline",
    input: { memories: [], now: new Date("2026-11-29T00:00:00Z") },
    contributions: { skills: [{ name: "research", description: "Search sources" }] },
  });
  assert.deepEqual(
    first.sections.slice(0, 2).map(({ id }) => id),
    ["model", "core-policy"],
  );
  assert.deepEqual(second.diff(first), {
    added: [],
    replaced: [second.sections.find(({ id }) => id === "temporal-environment")!],
    removed: [],
  });
  assert.equal(first.digest(), first.digest());
  assert.notEqual(first.digest(), second.digest());
});
