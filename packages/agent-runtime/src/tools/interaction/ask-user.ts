import { tool } from "ai";
import { z } from "zod";

import { defineAgentTool } from "../core/manifest.js";

export const askUserInputSchema = z.strictObject({
  questions: z
    .array(
      z.strictObject({
        id: z.string().min(1).describe("Stable identifier for mapping answers (snake_case)."),
        header: z.string().min(1).describe("Short header label shown in the UI (12 or fewer chars)."),
        question: z.string().min(1).describe("Single-sentence prompt shown to the user."),
        options: z
          .array(
            z.strictObject({
              label: z.string().min(1).describe("User-facing label (1-5 words)."),
              description: z
                .string()
                .min(1)
                .describe("One short sentence explaining the impact of selecting this option."),
            }),
          )
          .min(1)
          .describe(
            "Provide 2–3 mutually exclusive choices, recommended option first. The client supplies a free-form alternative.",
          ),
      }),
    )
    .min(1)
    .max(3)
    .refine(
      (questions) => new Set(questions.map((question) => question.id)).size === questions.length,
      "Question IDs must be unique.",
    ),
});

export const askUserResponseSchema = z.strictObject({
  answers: z.record(z.string().min(1), z.strictObject({ answers: z.array(z.string().trim().min(1)).min(1) })),
});

export function createInteractionToolManifests() {
  return [
    defineAgentTool(
      "ask_user",
      tool({
        description: "Ask the user one to three material questions, then resume with their answers.",
        strict: false,
        inputSchema: askUserInputSchema,
        outputSchema: askUserResponseSchema,
        toModelOutput: ({ output }) => ({ type: "text", value: JSON.stringify(output) }),
      }),
      { capability: "interaction", effect: "none", trust: "closed", execution: "client", uiKind: "ask-user" },
      { summary: "Pause once for material user input instead of guessing." },
    ),
  ];
}
