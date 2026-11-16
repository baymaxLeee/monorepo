import { estimateTextTokens } from "@backend/agent-runtime-ts/context-budget";

export { estimateTextTokens };

export function truncateToTokenBudget(value: string, tokenBudget: number): string {
  if (estimateTextTokens(value) <= tokenBudget) {
    return value;
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTextTokens(value.slice(0, middle)) <= tokenBudget) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return value.slice(0, low);
}
