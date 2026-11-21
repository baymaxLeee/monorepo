import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import { z } from "zod";

import { MAX_FILE_BYTES } from "../local-user-message";
import { within } from "../sandbox";

export const workspaceFileRequest = z.strictObject({ id: z.uuid(), path: z.string().min(1).max(4096) });
export const importAttachmentRequest = z.strictObject({
  id: z.uuid(),
  filename: z
    .string()
    .min(1)
    .refine(
      (name) =>
        name !== "." && name !== ".." && !/[/\\\u0000-\u001f\u007f]/u.test(name) && Buffer.byteLength(name) <= 255,
    ),
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= MAX_FILE_BYTES),
});

export function attachmentDirectory(directory: string, threadId: string) {
  return join(directory, "attachments", threadId);
}

export async function selectedWorkspacePath(workspace: string, path: string, protectedPaths: string[]) {
  if (!isAbsolute(path)) throw new Error("本地文件路径无效");
  const canonical = await realpath(path);
  if (protectedPaths.some((root) => within(root, canonical))) throw new Error("不能引用桌面运行时的控制文件");
  if (!within(workspace, canonical)) return null;
  const info = await lstat(canonical);
  if (!info.isFile() || info.nlink !== 1) throw new Error("请选择普通文件");
  return relative(workspace, canonical);
}

export async function storeAttachment(root: string, filename: string, bytes: Uint8Array) {
  const directory = join(root, createHash("sha256").update(bytes).digest("hex"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, filename);
  // Publish complete bytes atomically, even if two selections have the same name and digest.
  const temporary = join(root, randomUUID() + ".tmp");
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o400 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return target;
}
