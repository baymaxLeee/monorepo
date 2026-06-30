type FileLikePart = {
  type: string;
  url?: string;
  mediaType?: string;
  filename?: string;
  providerMetadata?: Record<string, unknown>;
};

const FILE_PART_PROVIDER = "monorepo";

export function documentIdFromFilePart(part: FileLikePart): string | null {
  if (part.type !== "file") return null;
  const provider = part.providerMetadata?.[FILE_PART_PROVIDER];
  if (
    provider &&
    typeof provider === "object" &&
    provider !== null &&
    typeof (provider as { documentId?: unknown }).documentId === "string"
  ) {
    return (provider as { documentId: string }).documentId;
  }
  if (typeof part.url === "string") {
    const match = part.url.match(/\/documents\/([^/?#]+)\/source/);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function referencedDocumentIdsFromParts(
  parts: Array<{ type: string; data?: unknown; url?: string; providerMetadata?: Record<string, unknown> }>,
): string[] {
  return parts.flatMap((part) => {
    if (part.type === "file") {
      const id = documentIdFromFilePart(part);
      return id ? [id] : [];
    }
    if (part.type === "data-plan-execution") {
      const id = (part.data as { document_id?: unknown } | undefined)?.document_id;
      return typeof id === "string" ? [id] : [];
    }
    return [];
  });
}

export function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith("image/");
}
