import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { z } from "zod";

// Constrained SDK provider protocol. Remote URLs, stored references, hosted
// tools and client-controlled provider options do not cross this boundary.
const text = z.strictObject({ type: z.literal("text"), text: z.string() });
const reasoning = z.strictObject({ type: z.literal("reasoning"), text: z.string() });
const inlineFile = z.strictObject({
  type: z.literal("file"),
  mediaType: z.string().max(200),
  filename: z.string().max(255).optional(),
  data: z.union([
    z.strictObject({ type: z.literal("data"), data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/) }),
    z.strictObject({ type: z.literal("text"), text: z.string() }),
  ]),
});
const resultOutput = z.union([
  z.strictObject({ type: z.enum(["text", "error-text"]), value: z.string() }),
  z.strictObject({ type: z.enum(["json", "error-json"]), value: z.json() }),
  z.strictObject({ type: z.literal("execution-denied"), reason: z.string().optional() }),
  z.strictObject({ type: z.literal("content"), value: z.array(z.union([text, inlineFile])) }),
]);
const toolResult = z.strictObject({
  type: z.literal("tool-result"),
  toolCallId: z.string(),
  toolName: z.string(),
  output: resultOutput,
});
const toolCall = z.strictObject({
  type: z.literal("tool-call"),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.json(),
  providerExecuted: z.literal(false).optional(),
});
const prompt = z
  .array(
    z.union([
      z.strictObject({ role: z.literal("system"), content: z.string() }),
      z.strictObject({ role: z.literal("user"), content: z.array(z.union([text, inlineFile])) }),
      z.strictObject({
        role: z.literal("assistant"),
        content: z.array(z.union([text, reasoning, inlineFile, toolCall, toolResult])),
      }),
      z.strictObject({ role: z.literal("tool"), content: z.array(toolResult) }),
    ]),
  )
  .min(1);

export const inferenceRequestSchema = z.strictObject({
  requestId: z.string().uuid(),
  agentId: z.string().min(1).max(32).nullable(),
  model: z.string().min(1).max(200),
  options: z.strictObject({
    prompt,
    maxOutputTokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    reasoning: z.enum(["provider-default", "none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
    tools: z
      .array(
        z.strictObject({
          type: z.literal("function"),
          name: z
            .string()
            .regex(/^[a-zA-Z0-9_-]+$/)
            .max(128),
          description: z.string().optional(),
          inputSchema: z.record(z.string(), z.json()),
          strict: z.boolean().optional(),
          inputExamples: z.array(z.strictObject({ input: z.record(z.string(), z.json()) })).optional(),
        }),
      )
      .max(128)
      .optional(),
    toolChoice: z
      .union([
        z.strictObject({ type: z.enum(["auto", "none", "required"]) }),
        z.strictObject({ type: z.literal("tool"), toolName: z.string() }),
      ])
      .optional(),
  }),
});
export type InferenceRequest = z.infer<typeof inferenceRequestSchema>;
export function modelOptions(request: InferenceRequest): LanguageModelV4CallOptions {
  return request.options;
}

export const inferenceConfigSchema = z.strictObject({
  agentId: z.string().nullable(),
  agentName: z.string(),
  model: z.string(),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  instructions: z.string(),
});
export type InferenceConfig = z.infer<typeof inferenceConfigSchema>;
