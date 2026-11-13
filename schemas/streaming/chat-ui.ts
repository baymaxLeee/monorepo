import { z } from "zod";

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});

export const chatMessageMetadataSchema = z
  .object({
    runId: z.string().min(1).max(32).optional(),
    providerId: z.string().max(32).optional(),
    model: z.string().max(120).optional(),
    responseId: z.string().nullable().optional(),
    parentResponseId: z.string().nullable().optional(),
    status: z.enum(["streaming", "completed", "failed", "cancelled"]).optional(),
    finishReason: z.string().optional(),
    usage: usageSchema.optional(),
    historyRevision: z.number().int().nonnegative().optional(),
    fork: z
      .object({
        conversationId: z.string().min(1).max(32),
        messageId: z.string().min(1).max(32),
      })
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.runId) {
      for (const key of ["providerId", "model", "status", "historyRevision"] as const) {
        if (value[key] === undefined) {
          context.addIssue({ code: "custom", path: [key], message: `${key} is required for run metadata` });
        }
      }
    } else if (!value.fork) {
      context.addIssue({ code: "custom", message: "metadata must describe a run or fork provenance" });
    }
  });

export const chatDataPartSchemas = {
  "plan-execution": z.object({ file_id: z.string().length(32) }).strict(),
  "conversation-title": z.object({ title: z.string().trim().min(1).max(200) }).strict(),
  "skill-activation": z.object({ name: z.string().min(1).max(120) }).strict(),
  file: z
    .object({
      file_id: z.string().length(32),
      filename: z.string().min(1).max(255),
      title: z.string().min(1).max(255),
      media_type: z.string().min(1).max(255),
      kind: z.string().min(1).max(32),
      etag: z.string().regex(/^"[a-f0-9]{32}"$/),
      updated: z.boolean(),
      workspace_path: z.string().min(1).max(4096).optional(),
    })
    .strict(),
};

export type ChatMessageMetadata = z.infer<typeof chatMessageMetadataSchema>;
export type ChatUIDataTypes = { [K in keyof typeof chatDataPartSchemas]: z.infer<(typeof chatDataPartSchemas)[K]> };
