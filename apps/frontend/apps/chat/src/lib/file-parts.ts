import type { FileUIPart } from "ai";
import { conversationDocumentSourceUrl } from "api";

export const FILE_PART_PROVIDER = "monorepo" as const;

export type MonorepoFileProviderMetadata = {
  documentId: string;
};

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
    providerMetadata: {
      [FILE_PART_PROVIDER]: {
        documentId: input.documentId,
      },
    },
  };
}

export function documentIdFromFilePart(part: FileUIPart): string | null {
  const provider = part.providerMetadata?.[FILE_PART_PROVIDER];
  if (
    provider &&
    typeof provider === "object" &&
    provider !== null &&
    typeof (provider as MonorepoFileProviderMetadata).documentId === "string"
  ) {
    return (provider as MonorepoFileProviderMetadata).documentId;
  }
  const match = part.url.match(/\/documents\/([^/?#]+)\/source/);
  return match?.[1] ?? null;
}
