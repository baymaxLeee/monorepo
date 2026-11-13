import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

import { within } from "./sandbox";

const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
async function safePath(root: string, path: string, create = false): Promise<string> {
  const target = resolve(root, path);
  if (!within(root, target)) throw new Error("文件不在授权工作目录内");
  let cursor = target;
  for (;;) {
    try {
      const canonical = await realpath(cursor);
      if (!within(root, canonical)) throw new Error("符号链接指向工作目录之外");
      break;
    } catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT" || cursor === root) throw error;
      cursor = dirname(cursor);
    }
  }
  return target;
}
async function run(input: {
  root: string;
  operation: string;
  path: string;
  content?: string;
  expectedHash?: string | null;
}) {
  const path = await safePath(input.root, input.path, input.operation === "write");
  if (input.operation === "list") {
    const items = await readdir(path, { withFileTypes: true });
    return items
      .map((item) => ({ name: item.name, directory: item.isDirectory(), symlink: item.isSymbolicLink() }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  }
  if (input.operation === "stat") {
    const info = await lstat(path);
    return { size: info.size, directory: info.isDirectory(), symlink: info.isSymbolicLink() };
  }
  let original: Buffer | null;
  let mode = 0o600;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1) throw new Error("仅支持普通文件，拒绝符号链接和硬链接");
    if (info.size > 2 * 1024 * 1024) throw new Error("文本编辑上限为 2 MiB；可使用命令处理该文件");
    mode = info.mode & 0o777;
    original = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || input.operation !== "write") throw error;
    original = null;
  }
  if (input.operation === "read") {
    if (!original) throw new Error("文件不存在");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(original);
    if (content.includes("\0")) throw new Error("该文件是二进制文件，请使用外部应用或命令处理");
    return { content, hash: hash(original) };
  }
  if (input.operation !== "write") throw new Error("不支持的文件操作");
  if (typeof input.content !== "string" || Buffer.byteLength(input.content) > 2 * 1024 * 1024)
    throw new Error("文件内容无效或过大");
  if ((original ? hash(original) : null) !== input.expectedHash)
    throw new Error("文件已改变，请重新读取后保存；当前草稿已保留");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.desktop-${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", mode);
    try {
      await handle.chmod(mode);
      await handle.writeFile(input.content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Recheck immediately before replacement. External editors are not subject
    // to our queue; this is optimistic concurrency, not a filesystem transaction.
    const latest = await readFile(path).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if ((latest ? hash(latest) : null) !== input.expectedHash) throw new Error("文件在保存期间改变，请重新读取");
    await rename(temporary, path);
    return { hash: hash(Buffer.from(input.content)) };
  } finally {
    await rm(temporary, { force: true });
  }
}

const lines = createInterface({ input: process.stdin });
lines.once("line", (line) => {
  lines.close();
  void run(JSON.parse(line))
    .then((result) => {
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    })
    .catch((error: unknown) => {
      process.stderr.write(error instanceof Error ? error.message : "文件操作失败");
      process.exit(1);
    });
});
