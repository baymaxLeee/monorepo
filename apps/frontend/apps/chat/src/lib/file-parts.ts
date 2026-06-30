import type { FileUIPart } from "ai";
import { conversationDocumentSourceUrl } from "api";

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
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
