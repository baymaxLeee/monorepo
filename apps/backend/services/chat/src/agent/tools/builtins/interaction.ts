import { tool } from "ai";
import { z } from "zod";

import type { AgentMode } from "../../agents/types.js";
import { defineAgentTool } from "../manifest.js";

const askUserQuestionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .describe(
      "Stable semantic identifier for this missing detail, reused by Skills when checking prior answers.",
    ),
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

const askUserInputSchema = z.object({
  questions: z
    .array(askUserQuestionSchema)
    .min(1)
    .max(5)
    .describe(
      "All currently known independent missing details. Ask them together instead of pausing once per question.",
    ),
}).superRefine((input, ctx) => {
  const ids = new Set<string>();
  for (const [index, question] of input.questions.entries()) {
    if (ids.has(question.id)) {
      ctx.addIssue({
        code: "custom",
        message: "question ids must be unique",
        path: ["questions", index, "id"],
      });
    }
    ids.add(question.id);
  }
});

const askUserOutputSchema = z.object({
  answers: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        values: z.array(z.string().min(1).max(160)).min(1),
      }),
    )
    .min(1),
});

export function createInteractionToolManifests(mode: AgentMode) {
  return [
    defineAgentTool(
      "ask_user",
      tool({
        description:
          mode === "plan"
            ? "Pause and ask the user for missing details that would materially change the plan. Put all currently known independent questions in one call, give each a stable semantic id, and never ask an id already answered in this turn."
            : "Pause and ask the user for missing details that would materially change the answer or deliverable. Put all currently known independent questions in one call, give each a stable semantic id, and never ask an id already answered in this turn.",
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
      { summary: "Pause once to collect one or more material clarifications instead of guessing." },
    ),
  ];
}
