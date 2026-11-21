import { Buffer } from "node:buffer";

import { z } from "zod";

import type { LocalUserMessagePart } from "../contracts/bridge.generated";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_PARTS = 8;
const MAX_MESSAGE_PARTS = MAX_FILE_PARTS * 2 + 1;
const MAX_TEXT_LENGTH = 64_000;
const MAX_DATA_URL_LENGTH = 14_100_000;

const partSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string().min(1).max(MAX_TEXT_LENGTH) }),
  z.strictObject({
    type: z.literal("file"),
    mediaType: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[\w.+-]+\/[\w.+-]+$/),
    filename: z.string().min(1).max(1024).optional(),
    url: z.string().max(MAX_DATA_URL_LENGTH),
  }),
]);

function validateInlineFile(part: Extract<LocalUserMessagePart, { type: "file" }>) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url);
  if (!match) throw new Error("本地附件必须是 base64 data URL");
  if (match[1]!.toLowerCase() !== part.mediaType.toLowerCase()) {
    throw new Error("本地附件媒体类型与内容不一致");
  }
  if (!part.mediaType.toLowerCase().startsWith("image/")) throw new Error("普通附件请使用本地文件路径");
  const encoded = match[2]!;
  if (encoded.length % 4 !== 0) throw new Error("本地附件编码无效");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("本地附件不能超过 10 MiB");
  if (bytes.toString("base64") !== encoded) throw new Error("本地附件编码无效");
}

export function parseLocalUserMessageParts(value: unknown): LocalUserMessagePart[] {
  const parts = z.array(partSchema).min(1).max(MAX_MESSAGE_PARTS).parse(value) as LocalUserMessagePart[];
  const files = parts.filter((part) => part.type === "file");
  if (files.length > MAX_FILE_PARTS) throw new Error("本地消息最多添加 8 个附件");
  const textLength = parts.reduce((length, part) => length + (part.type === "text" ? part.text.length : 0), 0);
  if (textLength > MAX_TEXT_LENGTH) throw new Error("本地消息正文不能超过 64000 个字符");
  for (const file of files) validateInlineFile(file);
  return parts;
}

export function localUserMessagePreview(parts: LocalUserMessagePart[]): string {
  const text = parts
    .filter((part): part is Extract<LocalUserMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(" ");
  if (text) return text;
  const filenames = parts
    .filter((part): part is Extract<LocalUserMessagePart, { type: "file" }> => part.type === "file")
    .map((part) => part.filename ?? "附件");
  return filenames.length > 0 ? filenames.join("、") : "新会话";
}
