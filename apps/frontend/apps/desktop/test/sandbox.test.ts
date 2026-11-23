import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  type SandboxAttempt,
  type SandboxAttemptResult,
  compilePermissionProfile,
  type PermissionProfile,
} from "@repo/agent-runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LocalSandbox, seatbeltProfile } from "../electron/sandbox";

describe.skipIf(process.platform !== "darwin")("macOS OS boundary and process ownership", () => {
  let directory: string, sandbox: LocalSandbox, profile: PermissionProfile;
  let processId = 0;
  const attempt = (): SandboxAttempt => ({
    attempt: 1,
    sandboxed: true,
    permissionProfile: profile,
    process: { processId: ++processId, entryId: `desktop-test-${processId}` },
    abortSignal: new AbortController().signal,
  });
  const run = (
    command: string,
    args: string[],
    input?: string,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<SandboxAttemptResult> => sandbox.execute(attempt(), command, args, input, signal, timeoutMs);
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "desktop-isolation-"));
    const root = join(directory, "workspace"),
      scratch = join(directory, "scratch");
    await mkdir(root);
    await mkdir(join(root, "control"));
    await writeFile(join(root, "control", "secret"), "control state");
    await mkdir(scratch);
    await writeFile(join(directory, "secret"), "must stay outside tools");
    sandbox = new LocalSandbox({
      root: await import("node:fs/promises").then((fs) => fs.realpath(root)),
      scratch: await import("node:fs/promises").then((fs) => fs.realpath(scratch)),
      executable: process.execPath,
      supervisor: resolve(import.meta.dirname, "../dist/supervisor"),
      fileWorker: resolve(import.meta.dirname, "../dist/file-worker.cjs"),
      protectedPaths: [await realpath(join(root, "control")), await realpath(join(directory, "secret"))],
      runtimePaths: [dirname(process.execPath)],
    });
    await sandbox.initialize();
    profile = compilePermissionProfile(":workspace", { workspaceRoot: sandbox.options.root }).profile;
  }, 60_000);
  afterAll(async () => {
    sandbox?.cancel();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("runs terminal input and output through a real sandboxed PTY", async () => {
    let text = "";
    const result = await sandbox.execute(
      attempt(),
      "/bin/sh",
      ["-c", 'test -t 0 && test -t 1 && read -r line && printf "answer=%s" "$line"'],
      undefined,
      undefined,
      5000,
      undefined,
      {
        tty: true,
        signal: new AbortController().signal,
        output(chunk) {
          text += chunk;
        },
        retainOutput() {},
        stdin(write) {
          void write("hello\n", "request");
        },
      },
    );
    expect(result).toMatchObject({ type: "exit", exitCode: 0 });
    expect(text).toContain("answer=hello");
  });

  it("retains complete streamed bytes in a thread-private read-only output file", async () => {
    const attachmentRoot = join(sandbox.options.root, "control", "attachments", "retained-thread");
    const complete = "x".repeat(100000);
    await mkdir(attachmentRoot, { recursive: true });
    let preview = "";
    let retainedPath: string | undefined;
    const result = await sandbox.execute(
      { ...attempt(), attachmentRoot },
      "/bin/sh",
      ["-c", "python3 -c 'import sys; sys.stdout.write(\"x\" * 100000)'"],
      undefined,
      undefined,
      5000,
      undefined,
      {
        tty: false,
        signal: new AbortController().signal,
        output(chunk) {
          preview += chunk;
        },
        retainOutput({ path }) {
          retainedPath = path;
        },
        stdin() {
          throw new Error("non-interactive command registered stdin");
        },
      },
    );
    expect(result).toMatchObject({ type: "exit", exitCode: 0 });
    expect(preview).toBe(complete);
    expect(retainedPath).toMatch(/\/\.runtime-output\/[a-f0-9-]+\.log$/u);
    expect(await readFile(retainedPath!)).toEqual(Buffer.from(complete));

    const read = await sandbox.execute({ ...attempt(), attachmentRoot }, "/bin/cat", [retainedPath!]);
    expect(read).toMatchObject({ type: "exit", exitCode: 0, stdout: complete });
    const write = await sandbox.execute({ ...attempt(), attachmentRoot }, "/bin/sh", [
      "-c",
      'printf corrupt > "$1"',
      "sh",
      retainedPath!,
    ]);
    expect(write.type === "exit" && write.exitCode !== 0).toBe(true);
    expect(await readFile(retainedPath!, "utf8")).toBe(complete);
  });

  it("allows authorized writes and rejects outside reads, writes and symlink escapes", async () => {
    const file = join(sandbox.options.root, "demo.txt");
    const secret = join(directory, "secret");
    const result = await run("/bin/sh", ["-c", `printf hello > demo.txt; cat '${secret}'`]);
    expect(await readFile(file, "utf8")).toBe("hello");
    expect(result).toMatchObject({ type: "exit" });
    if (result.type !== "exit") throw new Error(`unexpected result: ${result.type}`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("must stay outside");
    await symlink(secret, join(sandbox.options.root, "escape"));
    await expect(sandbox.file(profile, { operation: "read", path: "escape" })).rejects.toThrow();
    const writeOutside = await run("/bin/sh", ["-c", `printf corrupt > '${secret}'`]);
    expect(writeOutside).toMatchObject({ type: "exit" });
    if (writeOutside.type !== "exit") throw new Error(`unexpected result: ${writeOutside.type}`);
    expect(writeOutside.exitCode).not.toBe(0);
    expect(await readFile(secret, "utf8")).toBe("must stay outside tools");
  });

  it("executes file helpers under the same OS policy and rejects stale saves and deletes", async () => {
    const first = (await sandbox.file(profile, {
      operation: "write",
      path: "edit.txt",
      content: "first",
      expectedHash: null,
    })) as { hash: string };
    expect(await sandbox.file(profile, { operation: "read", path: "edit.txt" })).toEqual({
      content: "first",
      hash: first.hash,
    });
    await writeFile(join(sandbox.options.root, "edit.txt"), "external");
    await expect(
      sandbox.file(profile, { operation: "write", path: "edit.txt", content: "stale", expectedHash: first.hash }),
    ).rejects.toThrow("文件已改变");
    expect(await readFile(join(sandbox.options.root, "edit.txt"), "utf8")).toBe("external");
    await expect(
      sandbox.file(profile, { operation: "delete", path: "edit.txt", expectedHash: first.hash }),
    ).rejects.toThrow("文件已改变");
    const current = (await sandbox.file(profile, { operation: "read", path: "edit.txt" })) as { hash: string };
    await expect(
      sandbox.file(profile, { operation: "delete", path: "edit.txt", expectedHash: current.hash }),
    ).resolves.toEqual({ deleted: true });
    await expect(readFile(join(sandbox.options.root, "edit.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("can run the system Git toolchain inside the authorized workspace", async () => {
    const result = await run("/usr/bin/git", ["--version"]);
    expect(result).toMatchObject({ type: "exit", exitCode: 0 });
    expect(result.stdout).toContain("git version");
  });

  it("denies command network access unless the permission profile grants it", async () => {
    let hits = 0;
    const server = createServer((_request, response) => {
      hits++;
      response.end("reachable");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing port");
      const url = `http://127.0.0.1:${address.port}`;
      expect(await (await fetch(url)).text()).toBe("reachable");
      const result = await run("/usr/bin/curl", ["--max-time", "2", url]);
      expect(result).toMatchObject({ type: "exit" });
      if (result.type !== "exit") throw new Error(`unexpected result: ${result.type}`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("reachable");
      expect(hits).toBe(1);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it("grants only the selected thread source directory for shell reads, including in full-access mode", async () => {
    const control = join(sandbox.options.root, "control");
    const root = join(control, "attachments", "thread-a");
    const sibling = join(control, "attachments", "thread-b");
    await Promise.all([mkdir(root, { recursive: true }), mkdir(sibling, { recursive: true })]);
    const source = join(root, "source.txt");
    const other = join(sibling, "source.txt");
    await Promise.all([writeFile(source, "selected"), writeFile(other, "private")]);
    for (const sandboxed of [true, false]) {
      const execute = (cmd: string, ...args: string[]) =>
        sandbox.execute({ ...attempt(), sandboxed, attachmentRoot: root }, cmd, args);
      expect(await execute("/bin/cat", source)).toMatchObject({ exitCode: 0, stdout: "selected" });
      for (const blocked of [other, join(control, "secret")]) {
        expect(await execute("/bin/cat", blocked)).toMatchObject({ exitCode: 1, stdout: "" });
      }
      const write = await execute("/bin/sh", "-c", 'printf changed > "$1"', "sh", source);
      expect(write.type === "exit" && write.exitCode !== 0).toBe(true);
      expect(await readFile(source, "utf8")).toBe("selected");
    }
  });

  it("protects control data even inside an authorized directory", async () => {
    const result = await run("/bin/cat", [join(sandbox.options.root, "control/secret")]);
    expect(result).toMatchObject({ type: "exit" });
    if (result.type !== "exit") throw new Error(`unexpected result: ${result.type}`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("control state");
    await expect(sandbox.file(profile, { operation: "read", path: "control/secret" })).rejects.toThrow();
  });

  it("rejects a replacement directory before starting another command", async () => {
    const root = sandbox.options.root,
      original = `${root}-original`;
    await rename(root, original);
    await mkdir(root);
    try {
      await expect(run("/usr/bin/true", [])).rejects.toThrow("移动或替换");
    } finally {
      await rm(root, { recursive: true });
      await rename(original, root);
    }
  });

  it("kills detached descendants when their command completes", async () => {
    const script = `const {spawn}=require('node:child_process');const c=spawn('/bin/sleep',['60'],{detached:true,stdio:'ignore'});console.log(c.pid);c.unref()`;
    const result = await run(process.execPath, ["-e", script]);
    expect(result).toMatchObject({ type: "exit", exitCode: 0 });
    const pid = Number(result.stdout.trim());
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("cannot replace an inherited Seatbelt policy", async () => {
    const result = await run("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"]);
    expect(result).toMatchObject({ type: "exit" });
    if (result.type !== "exit") throw new Error(`unexpected result: ${result.type}`);
    expect(result.exitCode).not.toBe(0);
  });

  it("cleans detached children after the runtime parent is killed", async () => {
    const { root, scratch, supervisor, executable, fileWorker } = sandbox.options;
    const marker = `com.monorepo.desktop.death.${Date.now()}`;
    const seatbelt = seatbeltProfile(root, scratch, [dirname(executable), dirname(fileWorker)], [], profile, marker);
    const childCode = `const {spawn}=require('node:child_process'); const c=spawn('/bin/sleep',['60'],{detached:true,stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)`;
    const code = `const {spawn}=require('node:child_process');const c=spawn(${JSON.stringify(supervisor)},${JSON.stringify([marker, seatbelt, executable, "-e", childCode])},{cwd:${JSON.stringify(root)},stdio:['pipe','inherit','inherit']});setInterval(()=>{},1000)`;
    const parent = spawn(executable, ["-e", code], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin", ELECTRON_RUN_AS_NODE: "1" },
    });
    let pid = 0;
    try {
      parent.stdout.on("data", (data: Buffer) => {
        pid = Number(data.toString().trim());
      });
      await expect.poll(() => pid, { timeout: 3000 }).toBeGreaterThan(0);
      parent.kill("SIGKILL");
      await expect
        .poll(
          () => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 3000 },
        )
        .toBe(false);
    } finally {
      parent.kill("SIGKILL");
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already reaped */
        }
      }
    }
  });

  it("waits for cleanup when cancelled", async () => {
    const abort = new AbortController();
    const running = run("/bin/sleep", ["60"], undefined, abort.signal);
    setTimeout(() => abort.abort(), 100);
    await expect(running).rejects.toThrow("取消");
  });

  it("returns a distinct timeout with partial output", async () => {
    // Leave enough startup time for the Seatbelt supervisor under the aggregate
    // Vitest worker load; the command still cannot finish before this deadline.
    const result = await run("/bin/sh", ["-c", "printf before; sleep 60"], undefined, undefined, 1_000);
    expect(result).toMatchObject({ type: "timeout", timeoutMs: 1_000 });
    expect(result.stdout).toBe("before");
  });
});
