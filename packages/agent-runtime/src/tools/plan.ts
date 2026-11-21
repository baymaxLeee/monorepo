import { tool } from "ai";
import { z } from "zod";

import { defineAgentTool } from "./manifest.js";

export const updatePlanArgs = z.strictObject({
  explanation: z.string().nullish(),
  plan: z.array(
    z.strictObject({
      step: z.string(),
      status: z.enum(["pending", "in_progress", "completed"]),
    }),
  ),
});

export function createPlanningToolManifests() {
  return [
    defineAgentTool(
      "update_plan",
      tool({
        description:
          "Update the task plan with an optional explanation and the full list of steps. At most one step can be in_progress at a time.",
        inputSchema: updatePlanArgs,
        outputSchema: updatePlanArgs,
        execute: (args) => args,
        toModelOutput: () => ({ type: "text", value: "Plan updated" }),
      }),
      {
        capability: "planning",
        effect: "none",
        trust: "closed",
        execution: "inline",
        uiKind: "todo-list",
      },
      { summary: "Update the current task plan." },
    ),
  ];
}
