import { z } from "zod";

export const COMPACTION_STATE_VERSION = 2 as const;
const MAX_DOCUMENT_REFERENCE_CHARS = 256;

const boundedString = z.string().min(1).max(500);

export const compactionModelOutputSchema = z.object({
  summary: z.string().min(1).max(12_000),
  goals: z.array(boundedString).max(8),
  constraints: z.array(boundedString).max(8),
  decisions: z.array(boundedString).max(10),
  completedWork: z.array(boundedString).max(16),
  openQuestions: z.array(boundedString).max(8),
});

export interface CompactionState extends z.infer<typeof compactionModelOutputSchema> {
  version: typeof COMPACTION_STATE_VERSION;
  documentReferences: string[];
}

export function parseCompactionState(value: unknown): CompactionState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== COMPACTION_STATE_VERSION) return null;
  const parsed = compactionModelOutputSchema.safeParse(candidate);
  if (!parsed.success || !Array.isArray(candidate.documentReferences)) return null;
  const documentReferences = candidate.documentReferences.filter(
    (item): item is string =>
      typeof item === "string" && item.length > 0 && item.length <= MAX_DOCUMENT_REFERENCE_CHARS,
  );
  return {
    version: COMPACTION_STATE_VERSION,
    ...parsed.data,
    documentReferences: [...new Set(documentReferences)].slice(-32),
  };
}
