export interface RuntimeTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}

export const EMPTY_RUNTIME_TOKEN_USAGE: RuntimeTokenUsage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  totalTokens: null,
};

function token(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function addToken(left: number | null, right: number | null): number | null {
  return left == null && right == null ? null : (left ?? 0) + (right ?? 0);
}

export function runtimeTokenUsage(value: unknown): RuntimeTokenUsage {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const inputDetails = source.inputTokenDetails as { cacheReadTokens?: unknown } | undefined;
  const outputDetails = source.outputTokenDetails as { reasoningTokens?: unknown } | undefined;
  return {
    inputTokens: token(source.inputTokens),
    outputTokens: token(source.outputTokens),
    cachedInputTokens: token(inputDetails?.cacheReadTokens),
    reasoningTokens: token(outputDetails?.reasoningTokens),
    totalTokens: token(source.totalTokens),
  };
}

export function addRuntimeTokenUsage(left: RuntimeTokenUsage, right: RuntimeTokenUsage): RuntimeTokenUsage {
  return {
    inputTokens: addToken(left.inputTokens, right.inputTokens),
    outputTokens: addToken(left.outputTokens, right.outputTokens),
    cachedInputTokens: addToken(left.cachedInputTokens, right.cachedInputTokens),
    reasoningTokens: addToken(left.reasoningTokens, right.reasoningTokens),
    totalTokens: addToken(left.totalTokens, right.totalTokens),
  };
}
