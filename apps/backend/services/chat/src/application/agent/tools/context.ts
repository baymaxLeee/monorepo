import { z } from "zod";

export const fileToolContextSchema = z.object({
  userId: z.string(),
  conversationId: z.string(),
});
export type FileToolContext = z.infer<typeof fileToolContextSchema>;

export const knowledgeSearchToolContextSchema = z.object({
  userId: z.string(),
  orgId: z.string(),
});
export type KnowledgeSearchToolContext = z.infer<typeof knowledgeSearchToolContextSchema>;

export const memoryToolContextSchema = z.object({
  runId: z.string(),
  userId: z.string(),
});
export type MemoryToolContext = z.infer<typeof memoryToolContextSchema>;

export const artifactToolContextSchema = z.object({
  runId: z.string(),
  userId: z.string(),
  orgId: z.string(),
  conversationId: z.string(),
});
export type ArtifactToolContext = z.infer<typeof artifactToolContextSchema>;

export const mediaToolContextSchema = z.object({
  runId: z.string(),
  userId: z.string(),
  orgId: z.string(),
  conversationId: z.string(),
  attachedImageDocumentIds: z.array(z.string()).optional(),
});
export type MediaToolContext = z.infer<typeof mediaToolContextSchema>;
