import { assetRevisionContentUrl } from "@repo/api";
import type { FileUIPart } from "ai";

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
    url: assetRevisionContentUrl(input.assetId, input.revisionId, input.documentId),
  };
}

export function documentIdFromFilePart(part: FileUIPart): string | null {
  try {
    return new URL(part.url, window.location.origin).searchParams.get("document_id");
  } catch {
    return null;
  }
}
