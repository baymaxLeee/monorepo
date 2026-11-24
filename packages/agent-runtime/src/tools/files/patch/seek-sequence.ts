// Match patch context from strictest to most tolerant without changing source text.
function normalizePatchContext(text: string): string {
  return text
    .trim()
    .replace(/[‐‑‒–—―−]/gu, "-")
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[“”„‟]/gu, '"')
    .replace(/[\u00a0\u2002-\u200a\u202f\u205f\u3000]/gu, " ");
}

export function seekSequence(lines: string[], pattern: string[], start: number, endOfFile = false): number {
  if (!pattern.length) return start;
  const last = lines.length - pattern.length;
  const first = endOfFile ? Math.max(start, last) : start;
  for (const normalize of [
    (s: string) => s,
    (s: string) => s.trimEnd(),
    (s: string) => s.trim(),
    normalizePatchContext,
  ]) {
    const expected = pattern.map(normalize);
    for (let index = first; index <= last; index++) {
      if (expected.every((line, offset) => normalize(lines[index + offset]!) === line)) return index;
    }
  }
  throw new Error("apply_patch context was not found; reread the file and regenerate the patch");
}
