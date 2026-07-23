// A live no-tool request consumed ~6.5k tokens before user content; 8k preserves headroom for larger tool catalogs.
export const MODEL_CONTEXT_OVERHEAD_TOKENS = 8_000;

export interface ModelContextLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

export function effectiveModelInputWindow(limits: ModelContextLimits): number {
  return Math.max(
    512,
    limits.contextWindow -
      limits.maxOutputTokens -
      MODEL_CONTEXT_OVERHEAD_TOKENS,
  );
}
