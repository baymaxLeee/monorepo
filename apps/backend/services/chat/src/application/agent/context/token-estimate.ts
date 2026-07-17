export function estimateTextTokens(value: string): number {
  // CJK and surrogate pairs can approach one or more tokens per code unit; ASCII / 2 is conservative for JSON and code.
  let asciiChars = 0;
  let nonAsciiCodeUnits = 0;
  for (const character of value) {
    if (character.charCodeAt(0) <= 0x7f) {
      asciiChars += 1;
    } else {
      nonAsciiCodeUnits += character.length;
    }
  }
  return Math.ceil(asciiChars / 2) + nonAsciiCodeUnits;
}

export function truncateToTokenBudget(value: string, tokenBudget: number): string {
  if (estimateTextTokens(value) <= tokenBudget) return value;
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
