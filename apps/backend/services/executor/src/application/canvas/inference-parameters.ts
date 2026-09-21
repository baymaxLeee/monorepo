import { z } from "zod";

export const inferenceParametersSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  reasoningEffort: z.string().min(1).optional(),
});
export function inferenceOptions(
  parameters: z.infer<typeof inferenceParametersSchema> | undefined,
  providerMax: number,
) {
  return {
    temperature: parameters?.temperature,
    topP: parameters?.topP,
    maxOutputTokens: Math.min(parameters?.maxOutputTokens ?? providerMax, providerMax),
    providerOptions: parameters?.reasoningEffort
      ? { openai: { reasoningEffort: parameters.reasoningEffort } }
      : undefined,
  };
}
