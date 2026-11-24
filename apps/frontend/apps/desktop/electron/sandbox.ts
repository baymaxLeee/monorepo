import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";

import {
  type SandboxAttempt,
  type SandboxAttemptResult,
  type SandboxViolation,
  type ProcessIO,
  ProcessManager,
  compilePermissionProfile,
  type PermissionProfile,
} from "@repo/agent-runtime";

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
  attachmentRoot?: string,
): string {
  const ownershipDenial = `${marker}.ownership-denied`;
  if (permissionProfile.type === "external") {
    throw new Error("本地执行没有 external sandbox owner");
  }
  const protectedRules = protectedPaths.flatMap((path) => {
    const subtree = `(subpath ${quote(path)})`;
    if (attachmentRoot && within(path, attachmentRoot)) {
      return [
        `(deny file-read* (require-all ${subtree} (require-not (subpath ${quote(attachmentRoot)}))))`,
        `(deny file-write* ${subtree})`,
      ];
    }
    return [`(deny file-read* file-write* ${subtree})`];
  });
  if (permissionProfile.type === "disabled") {
    return [
      "(version 1)",
      "(allow default)",
      `(allow mach-lookup (global-name ${quote(marker)}))`,
      `(deny mach-lookup (global-name ${quote(ownershipDenial)}))`,
      ...protectedRules,
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
    ...(attachmentRoot ? [attachmentRoot] : []),
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
    `(deny mach-lookup (global-name ${quote(ownershipDenial)}))`,
    "(allow file-read-metadata)",
    '(allow file-read* (literal "/"))',
    `(allow file-read* ${readPaths.map((p) => `(subpath ${quote(p)})`).join(" ")})`,
    `(allow file-write* (subpath ${quote(scratch)}))`,
    ...fileRules,
    '(allow file-read* file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom"))',
    '(allow mach-lookup (global-name "com.apple.system.logger") (global-name "com.apple.system.notification_center"))',
    ...protectedRules,
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
  readonly processes = new ProcessManager();
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
    attempt: SandboxAttempt & { attachmentRoot?: string },
    command: string,
    args: string[],
    input?: string,
    signal?: AbortSignal,
    timeoutMs = 120_000,
    violationHint?: SandboxViolation,
    io?: ProcessIO,
    cwd?: string,
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
    const workingDirectory = cwd
      ? await realpath(isAbsolute(cwd) ? cwd : resolve(this.options.root, cwd))
      : this.options.root;
    if (!within(this.options.root, workingDirectory))
      throw new Error("workdir must stay inside the authorized workspace");
    const marker = `com.monorepo.desktop.run.${randomUUID()}`;
    const profile = seatbeltProfile(
      this.options.root,
      this.options.scratch,
      [this.options.executable, dirname(this.options.fileWorker), ...(this.options.runtimePaths ?? [])],
      this.options.protectedPaths,
      attempt.sandboxed ? attempt.permissionProfile : { type: "disabled" },
      marker,
      attempt.attachmentRoot,
    );
    let retainedOutput: WriteStream | undefined;
    let retainedOutputDone: Promise<void> | undefined;
    if (io && attempt.attachmentRoot) {
      const outputDirectory = join(attempt.attachmentRoot, ".runtime-output");
      await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
      const outputPath = join(outputDirectory, `${randomUUID()}.log`);
      retainedOutput = createWriteStream(outputPath, { flags: "wx", mode: 0o400 });
      await new Promise<void>((accept, reject) => {
        retainedOutput!.once("open", () => accept());
        retainedOutput!.once("error", reject);
      });
      retainedOutputDone = finished(retainedOutput);
      void retainedOutputDone.catch(() => undefined);
      try {
        io.retainOutput({ path: outputPath });
      } catch (error) {
        retainedOutput.destroy();
        await retainedOutputDone.catch(() => undefined);
        await rm(outputPath, { force: true });
        throw error;
      }
    }
    return new Promise<SandboxAttemptResult>((resolve, reject) => {
      const child = spawn(this.options.supervisor, [marker, profile, ...(io?.tty ? ["--pty"] : []), command, ...args], {
        cwd: workingDirectory,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: `${this.options.scratch}/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
          HOME: this.options.scratch,
          TMPDIR: this.options.scratch,
          LANG: "en_US.UTF-8",
        },
      });
      const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
      let stdout = "",
        stderr = "",
        diagnostic = "",
        bytes = 0,
        failure: Error | undefined,
        timedOut = false;
      const stop = (error = new Error("执行已取消")) => {
        failure ??= error;
        child.stdin.destroy();
      };
      retainedOutput?.on("error", (error) => {
        stop(new Error(`完整命令输出保留失败：${error.message}`, { cause: error }));
      });
      retainedOutput?.on("drain", () => {
        if (!failure && !operationSignal.aborted) {
          child.stdout.resume();
          child.stderr.resume();
        }
      });
      const cancel = () => stop();
      this.active.add(cancel);
      if (io?.tty)
        io.stdin(
          (chars) =>
            new Promise<void>((accept, fail) => {
              child.stdin.write(chars, (error) => (error ? fail(error) : accept()));
            }),
        );
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
        if (io) {
          if (retainedOutput && !retainedOutput.write(chunk)) {
            child.stdout.pause();
            child.stderr.pause();
          }
          const fragment = decoders[channel].write(chunk);
          io.output(fragment);
          if (channel === "stderr" || io.tty) diagnostic = (diagnostic + fragment).slice(-8192);
          return;
        }
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
        retainedOutput?.destroy();
        reject(error);
      });
      child.once("close", (code) => {
        cleanup();
        retainedOutput?.end();
        const finish = () => {
          if (failure) {
            reject(failure);
            return;
          }
          const output = { stdout: stdout + decoders.stdout.end(), stderr: stderr + decoders.stderr.end() };
          if (io) io.output(output.stdout + output.stderr);
          const errorText = io ? diagnostic : output.stderr;
          if (timedOut) resolve({ type: "timeout", timeoutMs, ...output });
          else if (code === 70)
            resolve({ type: "sandbox-unavailable", message: errorText || "Seatbelt unavailable", ...output });
          else if (
            violationHint &&
            code !== 0 &&
            /operation not permitted|permission denied|sandbox/iu.test(errorText)
          ) {
            resolve({ type: "sandbox-violation", violation: violationHint, ...output });
          } else resolve({ type: "exit", exitCode: code ?? 128, ...output });
        };
        if (retainedOutputDone) {
          void retainedOutputDone.then(finish, (error) => {
            reject(new Error(`完整命令输出保留失败：${error.message}`, { cause: error }));
          });
        } else finish();
      });
      if (input) child.stdin.write(`${input}\n`);
      if (operationSignal.aborted) cancel();
    });
  }

  async file(
    permissionProfile: PermissionProfile,
    operation: Record<string, unknown>,
    signal?: AbortSignal,
    attachmentRoot?: string,
  ): Promise<unknown> {
    const result = await this.processes.run((process, abortSignal) =>
      this.execute(
        {
          attempt: 1,
          sandboxed: permissionProfile.type !== "disabled",
          permissionProfile,
          attachmentRoot,
          process,
          abortSignal,
        },
        this.options.executable,
        [this.options.fileWorker],
        JSON.stringify({ ...operation, root: this.options.root, attachmentRoot }),
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
