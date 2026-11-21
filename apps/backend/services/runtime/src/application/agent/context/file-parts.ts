import { type FileUIPart, type ReasoningFileUIPart, type UIMessage } from "ai";

type ChatPart = UIMessage<unknown, any, any>["parts"][number];

export function documentIdFromFilePart(part: FileUIPart | ReasoningFileUIPart): string | null {
  try {
    const url = new URL(part.url, "http://internal");
    return url.searchParams.get("document_id");
  } catch {
    return null;
  }
}

export function sessionFileIdFromUrl(url: string, sessionId: string): string | null {
  const match = /^\/api\/chat-server\/sessions\/([^/]+)\/files\/([a-zA-Z0-9_-]{1,32})\/content$/.exec(url);
  return match?.[1] === sessionId ? match[2]! : null;
}

export function sessionFileUrl(sessionId: string, fileId: string) {
  return `/api/chat-server/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}/content`;
}

/** Skill the user explicitly invoked via `/`, carried as a persisted message
 *  part (not a side-band request field) so it survives reload/continuation and
 *  records which skill drove the turn. Returns the last one if several exist. */
export function activatedSkillNameFromParts(parts: ChatPart[]): string | null {
  let name: string | null = null;
  for (const part of parts) {
    if (part.type !== "data-skill-activation") {
      continue;
    }
    const value = (part.data as { name?: unknown } | undefined)?.name;
    if (typeof value === "string" && value.trim()) {
      name = value;
    }
  }
  return name;
}

export function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith("image/");
}
