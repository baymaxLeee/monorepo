import { tool } from "ai";

import { planToolContextSchema } from "../context.js";
import {
  updatePlanInputSchema,
  updatePlanTool,
  writePlanInputSchema,
  writePlanTool,
} from "../../plans/service.js";

export function createPlanTools() {
  return {
    write_plan: tool({
      description:
        "Create the active Markdown plan artifact. The content must contain the required Chinese plan headings and the filename is normalized to *-plan.md.",
      inputSchema: writePlanInputSchema,
      contextSchema: planToolContextSchema,
      execute: writePlanTool,
    }),
    update_plan: tool({
      description: "Replace the active Markdown plan using its document id and latest revision id.",
      inputSchema: updatePlanInputSchema,
      contextSchema: planToolContextSchema,
      execute: updatePlanTool,
    }),
  };
}
