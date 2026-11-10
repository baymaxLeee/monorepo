import { conversationDocumentContentUrl } from "@repo/api";
import type { FileUIPart, ReasoningFileUIPart } from "ai";

export function buildUserFilePart(input: {
  conversationId: string;
  documentId: string;
  assetId: string;
  revisionId: string;
  filename: string;
  mimeType: string;
}): FileUIPart {
  return {
    type: "file",
    mediaType: input.mimeType,
    filename: input.filename,
    url: conversationDocumentContentUrl(input.conversationId, input.documentId),
  };
}

export function documentIdFromFilePart(part: FileUIPart | ReasoningFileUIPart): string | null {
  try {
    return new URL(part.url, window.location.origin).searchParams.get("document_id");
  } catch {
    return null;
  }
}
