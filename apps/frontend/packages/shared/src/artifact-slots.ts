export type ArtifactSlotSegment =
  | { type: "text"; text: string }
  | { type: "slot"; documentId: string };

const ARTIFACT_SLOT_RE = /\[([a-f0-9]{16})\]/gi;
const LEGACY_DOCUMENT_REF_RE = /\[\[chat-document:([a-zA-Z0-9_-]+)\]\]/g;

const SLOT_PATTERN = new RegExp(
  `${ARTIFACT_SLOT_RE.source}|${LEGACY_DOCUMENT_REF_RE.source}`,
  "gi",
);

function captureDocumentId(match: RegExpMatchArray): string | undefined {
  return match[1] ?? match[2];
}

export function formatArtifactSlot(documentId: string): string {
  return `[${documentId}]`;
}

export function extractSlotIds(content: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const pattern of [ARTIFACT_SLOT_RE, LEGACY_DOCUMENT_REF_RE]) {
    for (const match of content.matchAll(pattern)) {
      const documentId = match[1];
      if (!documentId || seen.has(documentId)) continue;
      seen.add(documentId);
      ids.push(documentId);
    }
  }
  return ids;
}

export function parseSlots(content: string): ArtifactSlotSegment[] {
  const segments: ArtifactSlotSegment[] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(SLOT_PATTERN)) {
    const index = match.index ?? 0;
    const text = content.slice(lastIndex, index);
    if (text) {
      const previous = segments.at(-1);
      if (previous?.type === "text") {
        previous.text += text;
      } else {
        segments.push({ type: "text", text });
      }
    }
    const documentId = captureDocumentId(match);
    if (documentId) {
      segments.push({ type: "slot", documentId });
    }
    lastIndex = index + match[0].length;
  }
  const tail = content.slice(lastIndex);
  if (tail) {
    const previous = segments.at(-1);
    if (previous?.type === "text") {
      previous.text += tail;
    } else {
      segments.push({ type: "text", text: tail });
    }
  }
  return segments;
}

export interface SerializeSlotsInput {
  segments: Array<
    | { type: "text"; text: string }
    | { type: "token"; token: { id: string; meta?: Record<string, unknown> } }
  >;
}

export function serializeSlots(
  input: SerializeSlotsInput,
  idByTokenId: Record<string, string>,
): string {
  return input.segments
    .map((segment) => {
      if (segment.type === "text") return segment.text;
      const artifactId = resolveArtifactId(segment.token, idByTokenId);
      if (artifactId) return formatArtifactSlot(artifactId);
      return "";
    })
    .join("");
}

export function resolveArtifactId(
  token: { id: string; meta?: Record<string, unknown> },
  idByTokenId: Record<string, string> = {},
): string | undefined {
  const fromMeta = token.meta?.artifactId;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  const mapped = idByTokenId[token.id];
  if (mapped) return mapped;
  if (/^[a-f0-9]{16}$/i.test(token.id)) return token.id;
  const clientRef = token.meta?.clientRef;
  if (typeof clientRef === "string" && idByTokenId[clientRef]) {
    return idByTokenId[clientRef];
  }
  return undefined;
}

export function tokenIdByArtifactId(
  tokens: Array<{ id: string; meta?: Record<string, unknown> }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const token of tokens) {
    const artifactId = token.meta?.artifactId;
    if (typeof artifactId === "string" && artifactId) {
      map[token.id] = artifactId;
    }
  }
  return map;
}
