// A live no-tool request consumed ~6.5k tokens before user content; 8k preserves headroom for larger tool catalogs.
export const MODEL_CONTEXT_OVERHEAD_TOKENS = 8_000;
const CONTEXT_COMPACTION_INPUT_RATIO = 0.8;

export interface ModelContextLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

export function effectiveModelInputWindow(limits: ModelContextLimits): number {
  return Math.max(512, limits.contextWindow - limits.maxOutputTokens - MODEL_CONTEXT_OVERHEAD_TOKENS);
}

/**
 * Compact before the hard input limit. The reserved 20% absorbs token-estimator drift,
 * a large final tool result, and the server-side compaction pass itself.
 */
export function contextCompactionThreshold(limits: ModelContextLimits): number {
  return Math.max(1, Math.floor(effectiveModelInputWindow(limits) * CONTEXT_COMPACTION_INPUT_RATIO));
}

export function shouldResetStoredResponseLineage(
  inputTokens: number | null | undefined,
  limits: ModelContextLimits,
): boolean {
  return inputTokens === null || inputTokens === undefined || inputTokens >= contextCompactionThreshold(limits);
}
