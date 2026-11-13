import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LocalSandbox, seatbeltProfile } from "../electron/sandbox";

describe.skipIf(process.platform !== "darwin")("macOS OS boundary and process ownership", () => {
  let directory: string, sandbox: LocalSandbox;
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
  }, 60_000);
  afterAll(async () => {
    sandbox?.cancel();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("allows authorized writes and rejects outside reads, writes and symlink escapes", async () => {
    const file = join(sandbox.options.root, "demo.txt");
    const secret = join(directory, "secret");
    const result = await sandbox.execute("/bin/sh", ["-c", `printf hello > demo.txt; cat '${secret}'`]);
    expect(await readFile(file, "utf8")).toBe("hello");
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain("must stay outside");
    await symlink(secret, join(sandbox.options.root, "escape"));
    await expect(sandbox.file({ operation: "read", path: "escape" })).rejects.toThrow();
    expect((await sandbox.execute("/bin/sh", ["-c", `printf corrupt > '${secret}'`])).code).not.toBe(0);
    expect(await readFile(secret, "utf8")).toBe("must stay outside tools");
  });

  it("executes file helpers under the same OS policy and rejects stale saves", async () => {
    const first = (await sandbox.file({
      operation: "write",
      path: "edit.txt",
      content: "first",
      expectedHash: null,
    })) as { hash: string };
    expect(await sandbox.file({ operation: "read", path: "edit.txt" })).toEqual({ content: "first", hash: first.hash });
    await writeFile(join(sandbox.options.root, "edit.txt"), "external");
    await expect(
      sandbox.file({ operation: "write", path: "edit.txt", content: "stale", expectedHash: first.hash }),
    ).rejects.toThrow("文件已改变");
    expect(await readFile(join(sandbox.options.root, "edit.txt"), "utf8")).toBe("external");
  });

  it("can run the system Git toolchain inside the authorized workspace", async () => {
    const result = await sandbox.execute("/usr/bin/git", ["--version"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("git version");
  });

  it("denies command network access even to a reachable loopback service", async () => {
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
      const result = await sandbox.execute("/usr/bin/curl", ["--max-time", "2", url]);
      expect(result.code).not.toBe(0);
      expect(hits).toBe(1);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it("protects control data even inside an authorized directory", async () => {
    const result = await sandbox.execute("/bin/cat", [join(sandbox.options.root, "control/secret")]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain("control state");
    await expect(sandbox.file({ operation: "read", path: "control/secret" })).rejects.toThrow();
  });

  it("rejects a replacement directory before starting another command", async () => {
    const root = sandbox.options.root,
      original = `${root}-original`;
    await rename(root, original);
    await mkdir(root);
    try {
      await expect(sandbox.execute("/usr/bin/true", [])).rejects.toThrow("移动或替换");
    } finally {
      await rm(root, { recursive: true });
      await rename(original, root);
    }
  });

  it("kills detached descendants when their command completes", async () => {
    const script = `const {spawn}=require('node:child_process');const c=spawn('/bin/sleep',['60'],{detached:true,stdio:'ignore'});console.log(c.pid);c.unref()`;
    const result = await sandbox.execute(process.execPath, ["-e", script]);
    expect(result.code).toBe(0);
    const pid = Number(result.stdout.trim());
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("cannot replace an inherited Seatbelt policy", async () => {
    const result = await sandbox.execute("/usr/bin/sandbox-exec", [
      "-p",
      "(version 1)(allow default)",
      "/usr/bin/true",
    ]);
    expect(result.code).not.toBe(0);
  });

  it("cleans detached children after the runtime parent is killed", async () => {
    const { root, scratch, supervisor, executable, fileWorker } = sandbox.options;
    const marker = `com.monorepo.desktop.death.${Date.now()}`;
    const profile = seatbeltProfile(root, scratch, [dirname(executable), dirname(fileWorker)], [], marker);
    const childCode = `const {spawn}=require('node:child_process'); const c=spawn('/bin/sleep',['60'],{detached:true,stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)`;
    const code = `const {spawn}=require('node:child_process');const c=spawn(${JSON.stringify(supervisor)},${JSON.stringify([marker, profile, executable, "-e", childCode])},{cwd:${JSON.stringify(root)},stdio:['pipe','inherit','inherit']});setInterval(()=>{},1000)`;
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
    const running = sandbox.execute("/bin/sleep", ["60"], undefined, abort.signal);
    setTimeout(() => abort.abort(), 100);
    await expect(running).rejects.toThrow("取消");
  });
});
