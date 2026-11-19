import assert from "node:assert/strict";
import test from "node:test";

import { tool } from "ai";
import { z } from "zod";

import { defineAgentTool } from "../tools/manifest.js";
import { assembleInstructions } from "./assembler.js";
import { CORE_POLICY } from "./core-policy.js";

test("run-level instructions contain invariants instead of product workflows", () => {
  const instructions = assembleInstructions({ memories: [] });

  assert.ok(CORE_POLICY.length < 1_500);
  assert.match(instructions, /smallest sufficient next action/i);
  assert.doesNotMatch(instructions, /ECharts|generate_images|create_video_production|update_todos|step_protocol/i);
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
