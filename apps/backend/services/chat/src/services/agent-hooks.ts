import { defineHook } from "workflow";
import { z } from "zod";

export const askUserAnswerSchema = z.object({
  answers: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  answer: z.string().optional(),
  label: z.string().optional(),
  other: z.union([z.string(), z.boolean()]).optional(),
});

export type AskUserAnswer = z.infer<typeof askUserAnswerSchema>;

export const askUserHook = defineHook<AskUserAnswer>({ schema: askUserAnswerSchema });
