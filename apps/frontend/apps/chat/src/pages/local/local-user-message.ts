import type { PromptInputValue } from "@repo/ai-elements/prompt-input";
import type { LocalUserMessagePart } from "@repo/runtime/desktop";
import type { UIMessage } from "ai";

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`无法读取附件：${file.name}`));
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.startsWith("data:")) {
        reject(new Error(`无法读取附件：${file.name}`));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function localPromptMessageParts(
  value: PromptInputValue,
  referenceFile: (file: File) => Promise<string>,
): Promise<LocalUserMessagePart[]> {
  const parts = await Promise.all(
    value.segments.map(async (segment): Promise<LocalUserMessagePart | null> => {
      if (segment.type === "text") return segment.text ? { type: "text", text: segment.text } : null;
      const file = value.files[segment.token.id];
      if (!file) throw new Error(`附件不存在：${segment.token.label}`);
      if (!file.type.startsWith("image/")) return { type: "text", text: JSON.stringify(await referenceFile(file)) };
      return {
        type: "file",
        mediaType: file.type || "application/octet-stream",
        filename: file.name,
        url: await readDataUrl(file),
      };
    }),
  );
  const messageParts = parts.filter((part): part is LocalUserMessagePart => part !== null);
  if (!value.segments.some((segment) => segment.type === "text" && segment.text.trim())) {
    messageParts.push({ type: "text", text: "请阅读并处理我附加的文件。" });
  }
  return messageParts;
}

export function localUIMessageParts(parts: UIMessage["parts"]): LocalUserMessagePart[] {
  return parts.flatMap((part): LocalUserMessagePart[] => {
    if (part.type === "text") return part.text ? [{ type: "text", text: part.text }] : [];
    if (part.type === "file") {
      return [{ type: "file", mediaType: part.mediaType, filename: part.filename, url: part.url }];
    }
    return [];
  });
}
