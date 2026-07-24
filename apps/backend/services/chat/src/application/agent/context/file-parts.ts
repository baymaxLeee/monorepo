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
      return [];
    }
    return [];
  });
}

export function planExecutionPathFromParts(parts: ChatPart[]): string | null {
  for (const part of parts) {
    if (part.type !== "data-plan-execution") continue;
    const path = (part.data as { path?: unknown } | undefined)?.path;
    if (typeof path === "string" && path) return path;
  }
  return null;
}

export function hasUntrustedFilePart(parts: ChatPart[]): boolean {
  return parts.some((part) => isFileUIPart(part) && !documentIdFromFilePart(part));
}

/** Skill the user explicitly invoked via `/`, carried as a persisted message
 *  part (not a side-band request field) so it survives reload/continuation and
 *  records which skill drove the turn. Returns the last one if several exist. */
export function activatedSkillNameFromParts(parts: ChatPart[]): string | null {
  let name: string | null = null;
  for (const part of parts) {
    if (part.type !== "data-skill-activation") continue;
    const value = (part.data as { name?: unknown } | undefined)?.name;
    if (typeof value === "string" && value.trim()) name = value;
  }
  return name;
}

export function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith("image/");
}

export function attachedImageDocumentIdsFromParts(parts: ChatPart[]): string[] {
  return parts.flatMap((part) => {
    if (!isFileUIPart(part)) return [];
    const id = documentIdFromFilePart(part);
    if (!id || !isImageMediaType(String(part.mediaType ?? ""))) return [];
    return [id];
  });
}
