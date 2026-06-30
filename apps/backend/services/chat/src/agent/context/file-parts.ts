import { isFileUIPart, type FileUIPart, type UIMessage } from "ai";

type ChatPart = UIMessage<unknown, any, any>["parts"][number];

export function documentIdFromFilePart(part: FileUIPart): string | null {
  const match = part.url.match(/\/documents\/([^/?#]+)\/source(?:[?#]|$)/);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }
  return null;
}

export function referencedDocumentIdsFromParts(parts: ChatPart[]): string[] {
  return parts.flatMap((part) => {
    if (isFileUIPart(part)) {
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

export function hasUntrustedFilePart(parts: ChatPart[]): boolean {
  return parts.some((part) => isFileUIPart(part) && !documentIdFromFilePart(part));
}

export function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith("image/");
}
