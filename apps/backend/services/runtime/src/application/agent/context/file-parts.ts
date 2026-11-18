import { isFileUIPart, type FileUIPart, type ReasoningFileUIPart, type UIMessage } from "ai";

type ChatPart = UIMessage<unknown, any, any>["parts"][number];

export function documentIdFromFilePart(part: FileUIPart | ReasoningFileUIPart): string | null {
  try {
    const url = new URL(part.url, "http://internal");
    return url.searchParams.get("document_id");
  } catch {
    return null;
  }
}

export function sessionFileIdFromFilePart(part: FileUIPart | ReasoningFileUIPart): string | null {
  try {
    const url = new URL(part.url, "http://internal");
    return url.searchParams.get("file_id");
  } catch {
    return null;
  }
}

export function referencedDocumentIdsFromParts(parts: ChatPart[]): string[] {
  return parts.flatMap((part) => {
    if (isFileUIPart(part)) {
      const id = documentIdFromFilePart(part);
      return id ? [id] : [];
    }
    return [];
  });
}

export function hasUntrustedFilePart(parts: ChatPart[]): boolean {
  return parts.some((part) => isFileUIPart(part) && (part.providerReference != null || !documentIdFromFilePart(part)));
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

export function attachedImageDocumentIdsFromParts(parts: ChatPart[]): string[] {
  return parts.flatMap((part) => {
    if (!isFileUIPart(part)) {
      return [];
    }
    const id = documentIdFromFilePart(part);
    if (!id || !isImageMediaType(String(part.mediaType ?? ""))) {
      return [];
    }
    return [id];
  });
}
