export interface ProviderTokenBudget {
  context_window: number;
  max_output_tokens: number;
}

/** Volcengine Ark model limits (2026-07). Doubao 256k input + 256k output → 512k budget field. */
export const CHAT_MODEL_TOKEN_BUDGETS: Record<string, ProviderTokenBudget> = {
  "deepseek-v4-pro-260425": {
    context_window: 1_048_576,
    max_output_tokens: 393_216,
  },
  "deepseek-v4-pro": { context_window: 1_048_576, max_output_tokens: 393_216 },
  "glm-5-2-260617": { context_window: 1_048_576, max_output_tokens: 131_072 },
  "doubao-seed-2-1-pro-260628": {
    context_window: 524_288,
    max_output_tokens: 262_144,
  },
  "doubao-seed-evolving": {
    context_window: 524_288,
    max_output_tokens: 262_144,
  },
  "doubao-seed-evolving-latest-version": {
    context_window: 524_288,
    max_output_tokens: 262_144,
  },
};

export const CHAT_TOKEN_BUDGET_FALLBACK: ProviderTokenBudget = {
  context_window: 524_288,
  max_output_tokens: 262_144,
};

export function resolveChatTokenBudget(model: string): ProviderTokenBudget {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return CHAT_TOKEN_BUDGET_FALLBACK;
  const exact = CHAT_MODEL_TOKEN_BUDGETS[normalized];
  if (exact) return exact;
  for (const [key, budget] of Object.entries(CHAT_MODEL_TOKEN_BUDGETS)) {
    if (normalized.includes(key)) return budget;
  }
  return CHAT_TOKEN_BUDGET_FALLBACK;
}
