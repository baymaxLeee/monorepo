import { tool } from "ai";

import { toolContextSchema } from "../../contract.js";
import {
  updatePlanInputSchema,
  updatePlanTool,
  writePlanInputSchema,
  writePlanTool,
} from "./service.js";

export function createPlanTools() {
  return {
    write_plan: tool({
      description:
        "Create the active Markdown plan artifact. The content must contain the required Chinese plan headings and the filename is normalized to *-plan.md.",
      inputSchema: writePlanInputSchema,
      contextSchema: toolContextSchema,
      execute: writePlanTool,
    }),
    update_plan: tool({
      description: "Replace the active Markdown plan using its document id and latest revision id.",
      inputSchema: updatePlanInputSchema,
      contextSchema: toolContextSchema,
      execute: updatePlanTool,
    }),
  };
}

