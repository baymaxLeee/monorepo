import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative } from "node:path";
import { StringDecoder } from "node:string_decoder";

export function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith("../") && !isAbsolute(path));
}

function quote(value: string): string {
  if (/[\x00-\x1f]/.test(value)) throw new Error("目录包含不支持的控制字符");
  return JSON.stringify(value);
}

export function seatbeltProfile(
  root: string,
  scratch: string,
  runtimePaths: string[],
  protectedPaths: string[],
  marker = "com.monorepo.desktop.test",
): string {
  const readPaths = [
    "/System",
    "/usr/bin",
    "/usr/lib",
    "/usr/share",
    "/bin",
    "/sbin",
    "/Library/Apple",
    "/Library/Developer/CommandLineTools",
    "/Applications/Xcode.app/Contents/Developer",
    "/private/var/db/xcode_select_link",
    "/private/var/db/dyld",
    ...runtimePaths,
    root,
    scratch,
  ];
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-exec process-fork sysctl-read)",
    "(allow signal (target same-sandbox))",
    `(allow mach-lookup (global-name ${quote(marker)}))`,
    '(deny mach-lookup (global-name "com.monorepo.desktop.forbidden"))',
    "(allow file-read-metadata)",
    '(allow file-read* (literal "/"))',
    `(allow file-read* ${readPaths.map((p) => `(subpath ${quote(p)})`).join(" ")})`,
    `(allow file-write* (subpath ${quote(root)}) (subpath ${quote(scratch)}))`,
    '(allow file-read* file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom"))',
    '(allow mach-lookup (global-name "com.apple.system.logger") (global-name "com.apple.system.notification_center"))',
    ...protectedPaths.map((p) => `(deny file-read* file-write* (subpath ${quote(p)}))`),
  ].join("\n");
}

export interface SandboxOptions {
  root: string;
  scratch: string;
  supervisor: string;
  executable: string;
  fileWorker: string;
  protectedPaths: string[];
  runtimePaths?: string[];
}
export class LocalSandbox {
  private identity: { dev: number; ino: number } | null = null;
  private active = new Set<() => void>();
  constructor(readonly options: SandboxOptions) {}

  async initialize() {
    if (process.platform !== "darwin") throw new Error("本地执行目前仅支持 macOS + Seatbelt");
    const root = await realpath(this.options.root);
    if (root !== this.options.root) throw new Error("工作目录授权已变化，请重新选择目录");
    for (const resource of [this.options.supervisor, this.options.fileWorker, this.options.executable]) {
      if (within(root, await realpath(resource))) throw new Error("工作目录不能包含桌面运行程序");
    }
    this.identity = await stat(root);
    const result = await this.execute("/usr/bin/true", [], undefined, undefined, 10_000);
    if (result.code !== 0) throw new Error(`Seatbelt 启动自检失败（${result.code}）：${result.stderr}`);
  }

  async execute(command: string, args: string[], input?: string, signal?: AbortSignal, timeoutMs = 120_000) {
    signal?.throwIfAborted();
    const current = await stat(this.options.root);
    if (
      !this.identity ||
      current.dev !== this.identity.dev ||
      current.ino !== this.identity.ino ||
      (await realpath(this.options.root)) !== this.options.root
    )
      throw new Error("工作目录已被移动或替换，请重新授权");
    const marker = `com.monorepo.desktop.run.${randomUUID()}`;
    const profile = seatbeltProfile(
      this.options.root,
      this.options.scratch,
      [
        basename(dirname(this.options.executable)) === "MacOS"
          ? dirname(dirname(this.options.executable))
          : dirname(this.options.executable),
        dirname(this.options.fileWorker),
        ...(this.options.runtimePaths ?? []),
      ],
      this.options.protectedPaths,
      marker,
    );
    return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
      const child = spawn(this.options.supervisor, [marker, profile, command, ...args], {
        cwd: this.options.root,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: `${this.options.scratch}/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
          HOME: this.options.scratch,
          TMPDIR: this.options.scratch,
          LANG: "en_US.UTF-8",
          ELECTRON_RUN_AS_NODE: "1",
        },
      });
      const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
      let stdout = "",
        stderr = "",
        bytes = 0,
        failure: Error | undefined;
      const stop = (error = new Error("执行已取消")) => {
        failure ??= error;
        child.stdin.destroy();
      };
      const cancel = () => stop();
      this.active.add(cancel);
      const timeout = setTimeout(() => stop(new Error("命令超过执行时限")), timeoutMs);
      signal?.addEventListener("abort", cancel, { once: true });
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
        this.active.delete(cancel);
      };
      const collect = (chunk: Buffer, channel: "stdout" | "stderr") => {
        bytes += chunk.byteLength;
        if (bytes > 8 * 1024 * 1024) {
          stop(new Error("命令输出超过 8 MiB，请将结果写入工作文件"));
          return;
        }
        if (channel === "stdout") stdout += decoders.stdout.write(chunk);
        else stderr += decoders.stderr.write(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
      child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
      child.stdin.on("error", () => {
        /* Closing child input is normal at command completion. */
      });
      child.once("error", (error) => {
        cleanup();
        reject(error);
      });
      child.once("close", (code) => {
        cleanup();
        if (failure) reject(failure);
        else
          resolve({
            stdout: stdout + decoders.stdout.end(),
            stderr: stderr + decoders.stderr.end(),
            code: code ?? 128,
          });
      });
      if (input) child.stdin.write(`${input}\n`);
      if (signal?.aborted) cancel();
    });
  }

  async file(operation: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const result = await this.execute(
      this.options.executable,
      [this.options.fileWorker],
      JSON.stringify({ ...operation, root: this.options.root }),
      signal,
      30_000,
    );
    if (result.code !== 0) throw new Error(result.stderr.trim() || "文件操作被拒绝");
    return JSON.parse(result.stdout);
  }
  cancel() {
    for (const stop of this.active) stop();
  }
}
