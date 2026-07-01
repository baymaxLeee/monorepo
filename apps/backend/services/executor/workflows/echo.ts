import { z } from "zod";

export const echoInputSchema = z.object({ message: z.string().min(1).max(2000) });
export type EchoInput = z.infer<typeof echoInputSchema>;

async function echoStep(input: EchoInput) {
  "use step";
  return { echoed: input.message, at: new Date().toISOString() };
}

export async function echoWorkflow(input: EchoInput) {
  "use workflow";
  return await echoStep(input);
}
