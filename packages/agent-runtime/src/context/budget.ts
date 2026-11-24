// Measured fixed headroom for base instructions, the largest shared tool catalog,
// provider framing and one final tool result. Model limits remain host supplied.
export const RUNTIME_CONTEXT_OVERHEAD_TOKENS = 8_000;
const MAX_COMPACTION_SUMMARY_RESERVE_TOKENS = 6_000;
const COMPACTION_SUMMARY_FRAMING_TOKENS = 256;

export interface ModelContextLimits {
  contextWindow: number;
  maxOutputTokens: number;
  autoCompactTokenLimit?: number;
}

export interface ContextWindowPlan {
  inputCapacity: number;
  compactAt: number;
  summaryMaxTokens: number;
  recentTailTokens: number;
}

/** Resolves the one context contract used by journal projection and every
 * in-turn model sample. Provider input and output ceilings stay independent. */
export function resolveContextWindow(limits: ModelContextLimits): ContextWindowPlan {
  // Provider configuration exposes independent input and output ceilings. Treating
  // the output ceiling as part of the input window turns models with a very large
  // output allowance into artificially tiny-context models.
  const inputCapacity = Math.max(512, limits.contextWindow - RUNTIME_CONTEXT_OVERHEAD_TOKENS);
  // Cap a configured threshold at 90% of the context window. The SDK hosts
  // reserve instruction and tool overhead inside the input capacity.
  const compactAt = Math.max(
    1,
    Math.min(Math.floor(limits.contextWindow * 0.9), inputCapacity, limits.autoCompactTokenLimit ?? Infinity),
  );
  const summaryReserve = Math.min(
    MAX_COMPACTION_SUMMARY_RESERVE_TOKENS,
    compactAt,
    Math.max(512, Math.floor(compactAt / 2)),
  );
  return {
    inputCapacity,
    compactAt,
    summaryMaxTokens: Math.max(1, summaryReserve - COMPACTION_SUMMARY_FRAMING_TOKENS),
    recentTailTokens: compactAt - summaryReserve,
  };
}

export function shouldResetStoredResponseLineage(
  inputTokens: number | null | undefined,
  limits: ModelContextLimits,
): boolean {
  return inputTokens == null || inputTokens >= resolveContextWindow(limits).compactAt;
}
