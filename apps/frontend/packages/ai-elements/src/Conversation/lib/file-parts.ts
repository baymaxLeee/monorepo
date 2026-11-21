import type { FileUIPart, ReasoningFileUIPart } from "ai";

export function buildUserFilePart(input: {
  conversationId: string;
  fileId: string;
  filename: string;
  mimeType: string;
}): FileUIPart {
  return {
    type: "file",
    mediaType: input.mimeType,
    filename: input.filename,
    url: `/api/chat-server/conversations/${encodeURIComponent(input.conversationId)}/files/${encodeURIComponent(input.fileId)}/content`,
  };
}

export function documentIdFromFilePart(part: FileUIPart | ReasoningFileUIPart): string | null {
  try {
    return new URL(part.url, window.location.origin).searchParams.get("document_id");
  } catch {
    return null;
  }
}

export function conversationFileIdFromFilePart(part: FileUIPart | ReasoningFileUIPart): string | null {
  return (
    /^\/api\/chat-server\/(?:conversations|sessions)\/[^/]+\/files\/([a-zA-Z0-9_-]{1,32})\/content$/.exec(
      part.url,
    )?.[1] ?? null
  );
}
