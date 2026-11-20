// Measured fixed headroom for base instructions, the largest shared tool catalog,
// provider framing and one final tool result. Model limits remain host supplied.
export const RUNTIME_CONTEXT_OVERHEAD_TOKENS = 8_000;
export const COMPACTION_SUMMARY_RESERVE_TOKENS = 6_000;
const AUTO_COMPACTION_RATIO = 0.8;

export interface ModelContextLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

export function effectiveModelInputWindow(limits: ModelContextLimits): number {
  return Math.max(512, limits.contextWindow - limits.maxOutputTokens - RUNTIME_CONTEXT_OVERHEAD_TOKENS);
}

export function contextCompactionThreshold(limits: ModelContextLimits): number {
  return Math.max(1, Math.floor(effectiveModelInputWindow(limits) * AUTO_COMPACTION_RATIO));
}

/** Recent verbatim history retained after automatic compaction. The summary and
 * tail together target the same watermark that disconnects stored lineage. */
export function recentContextTailBudget(limits: ModelContextLimits): number {
  return Math.max(512, contextCompactionThreshold(limits) - COMPACTION_SUMMARY_RESERVE_TOKENS);
}

export function shouldResetStoredResponseLineage(
  inputTokens: number | null | undefined,
  limits: ModelContextLimits,
): boolean {
  return inputTokens == null || inputTokens >= contextCompactionThreshold(limits);
}
