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

// Run-scoped ids only. The agent's providers (text/image/video) are resolved
// once at the run entry and injected into the tool factories as closures, so no
// tool re-fetches a provider or needs a provider id in its context.
export const artifactToolContextSchema = z.object({
  runId: z.string(),
  userId: z.string(),
  conversationId: z.string(),
});
export type ArtifactToolContext = z.infer<typeof artifactToolContextSchema>;

export const mediaToolContextSchema = z.object({
  runId: z.string(),
  userId: z.string(),
  conversationId: z.string(),
});
export type MediaToolContext = z.infer<typeof mediaToolContextSchema>;
