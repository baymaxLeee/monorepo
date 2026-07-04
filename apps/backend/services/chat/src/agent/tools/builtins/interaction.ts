import { tool } from "ai";
import { z } from "zod";

import type { AgentMode } from "../../agents/types.js";
import { defineAgentTool } from "../manifest.js";

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

const askUserOutputSchema = z.union([
  z.object({ answer: z.string(), label: z.string(), other: z.boolean().optional() }),
  z.object({
    answers: z.array(z.string()),
    labels: z.array(z.string()),
    other: z.string().optional(),
  }),
]);

export function createInteractionToolManifests(mode: AgentMode) {
  return [
    defineAgentTool(
      "ask_user",
      tool({
        description:
          mode === "plan"
            ? "Ask for information required to finish the plan."
            : "Ask for information required to continue the task.",
        inputSchema: askUserInputSchema,
        outputSchema: askUserOutputSchema,
      }),
      {
        capability: "interaction",
        effect: "none",
        trust: "closed",
        execution: "client",
        modes: ["normal", "plan"],
        uiKind: "ask-user",
      },
      { summary: "Pause and ask the user for required information." },
    ),
  ];
}
