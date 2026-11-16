/** Conservative tokenizer-independent estimate for text, JSON and source code. */
export function estimateTextTokens(value: string): number {
  // CJK and surrogate pairs can approach one or more tokens per code unit; ASCII / 2 is conservative for JSON and code.
  let asciiChars = 0;
  let nonAsciiCodeUnits = 0;
  for (const character of value) {
    if (character.charCodeAt(0) <= 0x7f) asciiChars += 1;
    else nonAsciiCodeUnits += character.length;
  }
  return Math.ceil(asciiChars / 2) + nonAsciiCodeUnits;
}
