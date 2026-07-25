export interface ProviderTokenBudget {
  context_window_k: number;
  max_output_tokens_k: number;
}

/** Volcengine Ark model limits (2026-07), expressed as 1K = 1024 tokens. */
export const CHAT_MODEL_TOKEN_BUDGETS: Record<string, ProviderTokenBudget> = {
  "deepseek-v4-pro-260425": {
    context_window_k: 1024,
    max_output_tokens_k: 384,
  },
  "deepseek-v4-pro": { context_window_k: 1024, max_output_tokens_k: 384 },
  "glm-5-2-260617": { context_window_k: 1024, max_output_tokens_k: 128 },
  "doubao-seed-2-1-pro-260628": {
    context_window_k: 512,
    max_output_tokens_k: 256,
  },
  "doubao-seed-evolving": {
    context_window_k: 512,
    max_output_tokens_k: 256,
  },
  "doubao-seed-evolving-latest-version": {
    context_window_k: 512,
    max_output_tokens_k: 256,
  },
};

export const CHAT_TOKEN_BUDGET_FALLBACK: ProviderTokenBudget = {
  context_window_k: 512,
  max_output_tokens_k: 256,
};

export function resolveChatTokenBudget(model: string): ProviderTokenBudget {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return CHAT_TOKEN_BUDGET_FALLBACK;
  }
  const exact = CHAT_MODEL_TOKEN_BUDGETS[normalized];
  if (exact) {
    return exact;
  }
  for (const [key, budget] of Object.entries(CHAT_MODEL_TOKEN_BUDGETS)) {
    if (normalized.includes(key)) {
      return budget;
    }
  }
  return CHAT_TOKEN_BUDGET_FALLBACK;
}
