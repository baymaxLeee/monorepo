import { conversationDocumentSourceUrl } from "@repo/api";
import type { FileUIPart } from "ai";

export function buildUserFilePart(input: {
  conversationId: string;
  documentId: string;
  filename: string;
  mimeType: string;
}): FileUIPart {
  return {
    type: "file",
    mediaType: input.mimeType,
    filename: input.filename,
    url: conversationDocumentSourceUrl(input.conversationId, input.documentId),
  };
}

export function documentIdFromFilePart(part: FileUIPart): string | null {
  const match = part.url.match(/\/documents\/([^/?#]+)\/source(?:[?#]|$)/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
