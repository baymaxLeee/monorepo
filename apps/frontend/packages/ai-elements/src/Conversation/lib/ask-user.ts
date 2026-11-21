import { z } from "zod";

const question = z.object({
  id: z.string().min(1),
  header: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.object({ label: z.string().min(1), description: z.string().min(1) })).min(1),
});
const inputSchema = z.object({ questions: z.array(question).min(1).max(3) });
const outputSchema = z.object({
  answers: z.record(z.string(), z.object({ answers: z.array(z.string().min(1)).min(1) })),
});
const completed = z.object({ status: z.literal("completed"), data: outputSchema });

export type AskUserInput = z.infer<typeof inputSchema>;
export type AskUserOutput = z.infer<typeof outputSchema>;

export function parseAskUserInput(input: unknown): AskUserInput | null {
  return inputSchema.safeParse(input).data ?? null;
}
export function parseAskUserOutput(output: unknown): AskUserOutput | null {
  return completed.safeParse(output).data?.data ?? null;
}
