export interface ToolSearchDocument {
  name: string;
  text: string;
  namespaceText?: string;
}

export interface ToolSearchMatch {
  name: string;
  score: number;
}

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

function stem(term: string): string {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && /(ches|shes|sses|xes|zes)$/u.test(term)) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) return term.slice(0, -1);
  return term;
}

export function tokenizeToolSearchText(text: string): string[] {
  const normalized = text
    .normalize("NFC")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ");
  const words = /^[a-z0-9 ]*$/u.test(normalized)
    ? normalized.split(" ")
    : Array.from(wordSegmenter.segment(normalized), (segment) => (segment.isWordLike ? segment.segment : ""));
  return words
    .filter((word) => word && !STOP_WORDS.has(word))
    .map((word) => (/^[a-z0-9]+$/u.test(word) ? stem(word) : word));
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_$]/gu, "_");
}

interface IndexedDocument {
  name: string;
  nameTerms: ReadonlySet<string>;
  localNameTerms: readonly string[];
  textCounts: ReadonlyMap<string, number>;
  textLength: number;
  namespaceTerms: ReadonlySet<string>;
}

function indexDocument(document: ToolSearchDocument): IndexedDocument {
  const textCounts = new Map<string, number>();
  for (const term of tokenizeToolSearchText(document.text)) textCounts.set(term, (textCounts.get(term) ?? 0) + 1);
  const segments = document.name.split("__");
  return {
    name: document.name,
    nameTerms: new Set(tokenizeToolSearchText(document.name)),
    localNameTerms: [...new Set(tokenizeToolSearchText(segments.at(-1) ?? document.name))],
    textCounts,
    textLength: [...textCounts.values()].reduce((sum, count) => sum + count, 0),
    namespaceTerms: new Set(tokenizeToolSearchText(document.namespaceText ?? "")),
  };
}

/** BM25 over descriptions/schema text with stronger exact-name and namespace signals. */
export function rankToolSearch(
  query: string,
  documents: readonly ToolSearchDocument[],
  limit: number,
): ToolSearchMatch[] {
  const queryTerms = new Set(tokenizeToolSearchText(query));
  if (!queryTerms.size || !documents.length || limit <= 0) return [];
  const indexed = documents.map(indexDocument);
  const averageLength = indexed.reduce((sum, item) => sum + item.textLength, 0) / indexed.length || 1;
  const idf = new Map(
    [...queryTerms].map((term) => {
      const frequency = indexed.filter(
        (item) => item.nameTerms.has(term) || item.textCounts.has(term) || item.namespaceTerms.has(term),
      ).length;
      return [term, Math.log(1 + (indexed.length - frequency + 0.5) / (frequency + 0.5))] as const;
    }),
  );
  const exactQuery = normalizeName(query);
  const fullNameBonus = [...idf.values()].reduce((sum, value) => sum + value, 0);
  return indexed
    .flatMap((item) => {
      const norm = 1.2 * (0.25 + (0.75 * item.textLength) / averageLength);
      let score = 0;
      let covered = 0;
      for (const term of queryTerms) {
        const count = item.textCounts.get(term) ?? 0;
        const weight =
          (item.nameTerms.has(term) ? 3 : 0) +
          (item.namespaceTerms.has(term) ? 0.5 : 0) +
          (count * 2.2) / (count + norm);
        if (weight > 0) covered++;
        score += (idf.get(term) ?? 0) * weight;
      }
      if (!score) return [];
      if (item.localNameTerms.length && item.localNameTerms.every((term) => queryTerms.has(term)))
        score += fullNameBonus;
      const normalized = normalizeName(item.name);
      return [
        {
          name: item.name,
          score,
          covered,
          exact: normalized === exactQuery || normalized.endsWith(`__${exactQuery}`),
        },
      ];
    })
    .sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) || right.covered - left.covered || right.score - left.score,
    )
    .slice(0, limit)
    .map(({ name, score }) => ({ name, score }));
}

export function appendSchemaSearchText(schema: unknown, parts: string[], seen = new Set<unknown>()): void {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return;
  seen.add(schema);
  const value = schema as Record<string, unknown>;
  if (typeof value.description === "string") parts.push(value.description);
  if (value.properties && typeof value.properties === "object" && !Array.isArray(value.properties)) {
    for (const [name, property] of Object.entries(value.properties)) {
      parts.push(name);
      appendSchemaSearchText(property, parts, seen);
    }
  }
  appendSchemaSearchText(value.items, parts, seen);
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = value[key];
    if (Array.isArray(variants)) for (const variant of variants) appendSchemaSearchText(variant, parts, seen);
  }
}
