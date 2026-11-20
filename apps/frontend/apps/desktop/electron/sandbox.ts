import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { compilePermissionProfile, type PermissionProfile } from "@repo/agent-runtime/runtime/permissions";
import { ProcessManager } from "@repo/agent-runtime/runtime/process-manager";
import type {
  SandboxAttempt,
  SandboxAttemptResult,
  SandboxViolation,
} from "@repo/agent-runtime/runtime/tool-orchestrator";

export function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith("../") && !isAbsolute(path));
}

function quote(value: string): string {
  if (/[\x00-\x1f]/.test(value)) throw new Error("目录包含不支持的控制字符");
  return JSON.stringify(value);
}

export function seatbeltProfile(
  _root: string,
  scratch: string,
  runtimePaths: string[],
  protectedPaths: string[],
  permissionProfile: PermissionProfile,
  marker = "com.monorepo.desktop.test",
): string {
  if (permissionProfile.type === "external") {
    throw new Error("本地执行没有 external sandbox owner");
  }
  if (permissionProfile.type === "disabled") {
    return [
      "(version 1)",
      "(allow default)",
      `(allow mach-lookup (global-name ${quote(marker)}))`,
      '(deny mach-lookup (global-name "com.monorepo.desktop.forbidden"))',
      ...protectedPaths.map((p) => `(deny file-read* file-write* (subpath ${quote(p)}))`),
    ].join("\n");
  }
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
    "/private/etc/ssl",
    "/private/etc/hosts",
    "/private/etc/resolv.conf",
    "/private/etc/services",
    ...runtimePaths,
    scratch,
  ];
  const fileRules =
    permissionProfile.fileSystem.type === "unrestricted"
      ? ["(allow file-read* file-write*)"]
      : permissionProfile.fileSystem.entries.map((entry) => {
          const operation =
            entry.access === "read"
              ? "file-read*"
              : entry.access === "write"
                ? "file-read* file-write*"
                : "file-read* file-write*";
          const action = entry.access === "deny" ? "deny" : "allow";
          return `(${action} ${operation} (subpath ${quote(entry.path)}))`;
        });
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-exec process-fork sysctl-read)",
    ...(permissionProfile.network.type === "enabled" ? ["(allow network*)"] : []),
    "(allow signal (target same-sandbox))",
    `(allow mach-lookup (global-name ${quote(marker)}))`,
    '(deny mach-lookup (global-name "com.monorepo.desktop.forbidden"))',
    "(allow file-read-metadata)",
    '(allow file-read* (literal "/"))',
    `(allow file-read* ${readPaths.map((p) => `(subpath ${quote(p)})`).join(" ")})`,
    `(allow file-write* (subpath ${quote(scratch)}))`,
    ...fileRules,
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
  readonly processes = new ProcessManager<{ terminate(): void }>();
  constructor(readonly options: SandboxOptions) {}

  async initialize() {
    if (process.platform !== "darwin") throw new Error("本地执行目前仅支持 macOS + Seatbelt");
    const root = await realpath(this.options.root);
    if (root !== this.options.root) throw new Error("工作目录授权已变化，请重新选择目录");
    for (const resource of [this.options.supervisor, this.options.fileWorker, this.options.executable]) {
      if (within(root, await realpath(resource))) throw new Error("工作目录不能包含桌面运行程序");
    }
    this.identity = await stat(root);
    const profile = compilePermissionProfile(":workspace", { workspaceRoot: this.options.root }).profile;
    const result = await this.processes.run((process, abortSignal) =>
      this.execute(
        { attempt: 1, sandboxed: true, permissionProfile: profile, process, abortSignal },
        "/usr/bin/true",
        [],
        undefined,
        undefined,
        10_000,
      ),
    );
    if (result.type !== "exit" || result.exitCode !== 0) {
      throw new Error(`Seatbelt 启动自检失败：${result.stderr || result.type}`);
    }
  }

  async execute(
    attempt: SandboxAttempt,
    command: string,
    args: string[],
    input?: string,
    signal?: AbortSignal,
    timeoutMs = 120_000,
    violationHint?: SandboxViolation,
  ): Promise<SandboxAttemptResult> {
    const operationSignal = signal ? AbortSignal.any([signal, attempt.abortSignal]) : attempt.abortSignal;
    operationSignal.throwIfAborted();
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
      attempt.sandboxed ? attempt.permissionProfile : { type: "disabled" },
      marker,
    );
    return new Promise<SandboxAttemptResult>((resolve, reject) => {
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
        failure: Error | undefined,
        timedOut = false;
      const stop = (error = new Error("执行已取消")) => {
        failure ??= error;
        child.stdin.destroy();
      };
      const cancel = () => stop();
      this.active.add(cancel);
      const timeout = setTimeout(() => {
        timedOut = true;
        child.stdin.destroy();
      }, timeoutMs);
      operationSignal.addEventListener("abort", cancel, { once: true });
      const cleanup = () => {
        clearTimeout(timeout);
        operationSignal.removeEventListener("abort", cancel);
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
        else {
          const output = { stdout: stdout + decoders.stdout.end(), stderr: stderr + decoders.stderr.end() };
          if (timedOut) resolve({ type: "timeout", timeoutMs, ...output });
          else if (code === 70)
            resolve({ type: "sandbox-unavailable", message: output.stderr || "Seatbelt unavailable", ...output });
          else if (
            violationHint &&
            code !== 0 &&
            /operation not permitted|permission denied|sandbox/iu.test(output.stderr)
          ) {
            resolve({ type: "sandbox-violation", violation: violationHint, ...output });
          } else resolve({ type: "exit", exitCode: code ?? 128, ...output });
        }
      });
      if (input) child.stdin.write(`${input}\n`);
      if (operationSignal.aborted) cancel();
    });
  }

  async file(
    permissionProfile: PermissionProfile,
    operation: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const result = await this.processes.run((process, abortSignal) =>
      this.execute(
        {
          attempt: 1,
          sandboxed: permissionProfile.type !== "disabled",
          permissionProfile,
          process,
          abortSignal,
        },
        this.options.executable,
        [this.options.fileWorker],
        JSON.stringify({ ...operation, root: this.options.root }),
        signal,
        30_000,
      ),
    );
    if (result.type !== "exit" || result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() || (result.type === "sandbox-violation" ? "文件操作被 sandbox 拒绝" : "文件操作被拒绝"),
      );
    }
    return JSON.parse(result.stdout);
  }
  cancel() {
    this.processes.closeAll();
    for (const stop of this.active) stop();
  }
}
