import { z } from "zod";

export const fileToolContextSchema = z.object({
  userId: z.string(),
  conversationId: z.string(),
});
export type FileToolContext = z.infer<typeof fileToolContextSchema>;

export const memoryToolContextSchema = z.object({
  runId: z.string(),
  userId: z.string(),
});
export type MemoryToolContext = z.infer<typeof memoryToolContextSchema>;

export const planToolContextSchema = fileToolContextSchema;
export type PlanToolContext = FileToolContext;

export const artifactToolContextSchema = z.object({
  runId: z.string(),
  userId: z.string(),
  conversationId: z.string(),
  providerId: z.string(),
});
export type ArtifactToolContext = z.infer<typeof artifactToolContextSchema>;

// Media generation resolves its own provider(s) by run-scoped ids rather than
// the chat language-model provider, so the chat model and the image/video
// models stay independent. `multimodalProviderId` is the image provider;
// `videoProviderId` is the video provider (they are usually distinct Ark
// endpoints, e.g. Seedream vs Seedance).
export const mediaToolContextSchema = z.object({
  runId: z.string(),
  userId: z.string(),
  conversationId: z.string(),
  multimodalProviderId: z.string().nullable(),
  videoProviderId: z.string().nullable(),
});
export type MediaToolContext = z.infer<typeof mediaToolContextSchema>;
