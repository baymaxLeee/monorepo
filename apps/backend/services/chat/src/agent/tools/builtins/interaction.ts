import { tool } from "ai";
import { z } from "zod";

import type { AgentMode } from "../../agents/types.js";
import { defineAgentTool } from "../manifest.js";

const askUserInputSchema = z.object({
  question: z
    .string()
    .min(1)
    .max(240)
    .describe(
      "One concise clarification question. Ask only for information needed to choose the correct path.",
    ),
  choices: z
    .array(
      z.object({
        label: z.string().min(1).max(80).describe("Short user-visible option label."),
        value: z
          .string()
          .min(1)
          .max(160)
          .describe("The exact value to return if selected."),
      }),
    )
    .max(8)
    .describe("Known plausible answers. Prefer 2-5 choices when they help the user decide.")
    .default([]),
  mode: z
    .enum(["single", "multiple"])
    .describe("Use multiple only when several choices can apply.")
    .default("single"),
  allow_freeform: z
    .boolean()
    .describe("Keep true unless the task only accepts one of the provided fixed choices.")
    .default(true),
  freeform_label: z
    .string()
    .min(1)
    .max(40)
    .describe("Label for the freeform answer option.")
    .default("其他"),
}).superRefine((input, ctx) => {
  if (!input.allow_freeform && input.choices.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "choices must be non-empty when freeform answers are disabled",
      path: ["choices"],
    });
  }

  const values = new Set<string>();
  for (const [index, choice] of input.choices.entries()) {
    if (values.has(choice.value)) {
      ctx.addIssue({
        code: "custom",
        message: "choice values must be unique",
        path: ["choices", index, "value"],
      });
    }
    values.add(choice.value);
  }
});

// The interactive UI (single / multiple / freeform) lives entirely on the
// client; what the model and history need is only the user's answer as plain
// text. Multiple selections are joined into one string on submit, so the
// persisted output stays a single request→response string regardless of mode.
const askUserOutputSchema = z.string();

export function createInteractionToolManifests(mode: AgentMode) {
  return [
    defineAgentTool(
      "ask_user",
      tool({
        description:
          mode === "plan"
            ? "Pause and ask the user for a missing detail that would materially change the plan. Use this instead of guessing when scope, target, source material, constraints, or success criteria are ambiguous."
            : "Pause and ask the user for a missing detail that would materially change the answer or deliverable. Use this before committing to an uncertain artifact, search, private-context lookup, irreversible action, or high-impact assumption.",
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
      { summary: "Pause and ask the user for a material clarification instead of guessing." },
    ),
  ];
}
