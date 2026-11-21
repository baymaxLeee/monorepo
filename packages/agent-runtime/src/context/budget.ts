// Measured fixed headroom for base instructions, the largest shared tool catalog,
// provider framing and one final tool result. Model limits remain host supplied.
export const RUNTIME_CONTEXT_OVERHEAD_TOKENS = 8_000;
export const COMPACTION_SUMMARY_RESERVE_TOKENS = 6_000;

export interface ModelContextLimits {
  contextWindow: number;
  maxOutputTokens: number;
  autoCompactTokenLimit?: number;
}

export function effectiveModelInputWindow(limits: ModelContextLimits): number {
  return Math.max(512, limits.contextWindow - limits.maxOutputTokens - RUNTIME_CONTEXT_OVERHEAD_TOKENS);
}

export function contextCompactionThreshold(limits: ModelContextLimits): number {
  // ModelInfo::auto_compact_token_limit caps a configured threshold at 90% of the context window.
  // The SDK hosts also reserve their advertised output and instruction/tool overhead.
  return Math.max(
    1,
    Math.min(
      Math.floor(limits.contextWindow * 0.9),
      effectiveModelInputWindow(limits),
      limits.autoCompactTokenLimit ?? Infinity,
    ),
  );
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
