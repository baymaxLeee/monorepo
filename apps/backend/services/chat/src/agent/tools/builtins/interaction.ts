import { tool } from "ai";
import { z } from "zod";

import type { AgentMode } from "../../agents/types.js";

const askUserInputSchema = z.object({
  question: z.string().min(1).max(240),
  choices: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        value: z.string().min(1).max(160),
      }),
    )
    .max(8)
    .default([]),
  mode: z.enum(["single", "multiple"]).default("single"),
  allow_freeform: z.boolean().default(true),
  freeform_label: z.string().min(1).max(40).default("其他"),
});

export function createInteractionTools(mode: AgentMode) {
  return {
    ask_user: tool({
      description:
        mode === "plan"
          ? "Ask the user for missing information that is required to finish the plan."
          : "Ask the user for missing information that is required to continue.",
      inputSchema: askUserInputSchema,
    }),
  };
}
