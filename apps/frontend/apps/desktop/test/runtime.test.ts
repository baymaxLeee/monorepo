import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { isToolUIPart } from "ai";
import { afterEach, describe, expect, it } from "vitest";

import type { InferenceRequest } from "../contracts/inference.generated";
import { LocalSessionHost, type SessionHostOptions } from "../electron/session-host";

const finish: LanguageModelV4StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
};
function reply(parts: LanguageModelV4StreamPart[]) {
  return new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      for (const part of parts) controller.enqueue(part);
      controller.enqueue(finish);
      controller.close();
    },
  });
}
const text = (): LanguageModelV4StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: "已完成" },
  { type: "text-end", id: "t" },
];
const directories: string[] = [],
  runtimes: LocalSessionHost[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture(call: SessionHostOptions["call"]) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "local-agent-")));
  directories.push(directory);
  const workspace = join(directory, "project");
  await mkdir(workspace);
  const options: SessionHostOptions = {
    directory: join(directory, "state"),
    controlDirectory: join(directory, "state"),
    supervisor: resolve(import.meta.dirname, "../dist/supervisor"),
    executable: process.execPath,
    fileWorker: resolve(import.meta.dirname, "../dist/file-worker.cjs"),
    config: async () => ({
      agentId: null,
      agentName: "test",
      model: "test",
      contextWindow: 100_000,
      maxOutputTokens: 4000,
      instructions: "",
    }),
    call,
    emit() {},
  };
  const runtime = new LocalSessionHost(options);
  runtimes.push(runtime);
  const thread = await runtime.create(workspace, null);
  return { runtime, thread, options };
}
async function done(runtime: LocalSessionHost, id: string) {
  await expect.poll(() => runtime.get(id).status, { timeout: 8000 }).not.toBe("running");
  return runtime.get(id);
}

describe.skipIf(process.platform !== "darwin")("local Agent owns execution and recovery", () => {
  it("does not invent workspace changes for a capability question", async () => {
    const requests: InferenceRequest[] = [];
    const f = await fixture(async (request) => {
      requests.push(request);
      return reply(text());
    });
    f.runtime.send(f.thread.id, "你能帮我干啥？", randomUUID());
    expect((await done(f.runtime, f.thread.id)).status).toBe("idle");
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0]!.options.prompt)).not.toContain("工作区内容已变化");
  });

  it("delivers a real workspace change once across read-only model steps", async () => {
    const requests: InferenceRequest[] = [];
    const f = await fixture(async (request) => {
      requests.push(request);
      return reply(
        requests.length < 3
          ? [
              {
                type: "tool-call",
                toolCallId: `list-${requests.length}`,
                toolName: "bash",
                input: JSON.stringify({ command: "ls" }),
              },
            ]
          : text(),
      );
    });
    let notified = false;
    f.options.emit = (event) => {
      if (event.type === "files") notified = true;
    };
    await writeFile(join(f.thread.workspace, "external.txt"), "changed");
    await expect.poll(() => notified).toBe(true);
    f.runtime.send(f.thread.id, "查看文件", randomUUID());
    expect((await done(f.runtime, f.thread.id)).status).toBe("idle");
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[0]!.options.prompt)).toContain("external.txt");
    for (const request of requests.slice(1))
      expect(JSON.stringify(request.options.prompt)).not.toContain("工作区内容已变化");
  });

  it("executes shared sandbox tools, persists history and supplies external changes to the next turn", async () => {
    const requests: InferenceRequest[] = [];
    const f = await fixture(async (request) => {
      requests.push(request);
      return reply(
        requests.length === 1
          ? [
              {
                type: "tool-call",
                toolCallId: "write",
                toolName: "bash",
                input: JSON.stringify({ command: "printf one > demo.js" }),
              },
            ]
          : text(),
      );
    });
    f.runtime.send(f.thread.id, "create", randomUUID());
    expect((await done(f.runtime, f.thread.id)).status).toBe("idle");
    expect(await readFile(join(f.thread.workspace, "demo.js"), "utf8")).toBe("one");
    let edited = false;
    f.options.emit = (event) => {
      if (event.type === "files" && event.paths.includes("demo.js")) edited = true;
    };
    await writeFile(join(f.thread.workspace, "demo.js"), "user edited");
    await expect.poll(() => edited).toBe(true);
    f.runtime.send(f.thread.id, "check edits", randomUUID());
    expect((await done(f.runtime, f.thread.id)).status).toBe("idle");
    expect(JSON.stringify(requests.at(-1)?.options.prompt)).toContain("工作区内容已变化");
    await f.runtime.close();
    runtimes.splice(runtimes.indexOf(f.runtime), 1);
    const reopened = new LocalSessionHost(f.options);
    runtimes.push(reopened);
    expect(reopened.get(f.thread.id).messages.filter((message) => message.role === "user")).toHaveLength(2);
    expect(await readFile(join(f.thread.workspace, "demo.js"), "utf8")).toBe("user edited");
  });

  it("uses the common Bash policy and terminal result without a local-only approval gate", async () => {
    let calls = 0;
    const f = await fixture(async () =>
      reply(
        ++calls === 1
          ? [
              {
                type: "tool-call",
                toolCallId: "shell",
                toolName: "bash",
                input: JSON.stringify({ command: "printf allowed > result.txt" }),
              },
            ]
          : text(),
      ),
    );
    f.runtime.send(f.thread.id, "run", randomUUID());
    const completed = await done(f.runtime, f.thread.id);
    expect(completed.status).toBe("idle");
    expect(await readFile(join(f.thread.workspace, "result.txt"), "utf8")).toBe("allowed");
    const part = completed.messages.flatMap((message) => message.parts).find((part) => isToolUIPart(part));
    expect(part).toMatchObject({
      state: "output-available",
      toolMetadata: { agent: { uiKind: "terminal" } },
      output: { ok: true, status: "completed", data: { exitCode: 0 } },
    });
    expect(calls).toBe(2);
  });

  it("stops a pending inference and reopens interrupted history without replaying tools", async () => {
    const f = await fixture(
      async (_request, signal) =>
        new ReadableStream({
          start(controller) {
            signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
          },
        }),
    );
    f.runtime.send(f.thread.id, "wait", randomUUID());
    await expect.poll(() => f.runtime.openStream(f.thread.id).segment).not.toBe(null);
    await f.runtime.stop(f.thread.id);
    expect(f.runtime.get(f.thread.id).status).toBe("cancelled");
    const interrupted = f.runtime.get(f.thread.id);
    interrupted.status = "running";
    f.runtime.journal.save(interrupted);
    await f.runtime.close();
    runtimes.splice(runtimes.indexOf(f.runtime), 1);
    const reopened = new LocalSessionHost(f.options);
    runtimes.push(reopened);
    expect(reopened.get(f.thread.id).status).toBe("interrupted");
  });
});
