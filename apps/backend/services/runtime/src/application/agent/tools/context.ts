import { z } from "zod";

import { mediaCapabilitiesSchema } from "../../../infrastructure/provider/capability.js";

export const subagentToolContextSchema = z.object({
  runId: z.string(),
});
export type SubagentToolContext = z.infer<typeof subagentToolContextSchema>;

export const artifactToolContextSchema = z.object({
  runId: z.string(),
  sessionId: z.string(),
});
export type ArtifactToolContext = z.infer<typeof artifactToolContextSchema>;

export const mediaToolContextSchema = z.object({
  runId: z.string(),
  sessionId: z.string(),
  media: mediaCapabilitiesSchema,
});
export type MediaToolContext = z.infer<typeof mediaToolContextSchema>;
