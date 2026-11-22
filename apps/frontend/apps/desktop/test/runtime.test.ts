import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { type AgentPluginManifest, type ResolvedTurnPluginSnapshot, defineAgentTool } from "@repo/agent-runtime";
import { isToolUIPart, tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { DesktopEvent, LocalPluginActivation } from "../contracts/bridge.generated";
import type { InferenceRequest } from "../contracts/inference.generated";
import { LocalJournal } from "../electron/runtime/journal";
import { importLocalPlugin, listLocalPlugins } from "../electron/runtime/local-plugins";
import { DesktopSessionManager, type DesktopSessionOptions } from "../electron/runtime/session-manager";

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
const user = (value: string) => [{ type: "text" as const, text: value }];
const directories: string[] = [],
  runtimes: DesktopSessionManager[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture(
  call: DesktopSessionOptions["call"],
  overrides: Partial<
    Pick<DesktopSessionOptions, "config" | "emit" | "pluginLoader" | "resolvePlugins" | "waitForModelRetry">
  > = {},
  pluginActivations: LocalPluginActivation[] = [],
) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "local-agent-")));
  directories.push(directory);
  const workspace = join(directory, "project");
  await mkdir(workspace);
  const options: DesktopSessionOptions = {
    directory: join(directory, "state"),
    controlDirectories: [join(directory, "state")],
    supervisor: resolve(import.meta.dirname, "../dist/supervisor"),
    executable: process.execPath,
    fileWorker: resolve(import.meta.dirname, "../dist/file-worker.cjs"),
    config: async () => ({
      providerId: "provider",
      providerName: "test",
      reasoningEffort: "medium",
      model: "test",
      contextWindow: 100_000,
      maxOutputTokens: 4000,
      instructions: "",
    }),
    resolvePlugins: async () => ({
      schemaVersion: 1,
      snapshotId: randomUUID(),
      snapshotDigest: `sha256:${"0".repeat(64)}`,
      workspaceRevision: 1,
      tenantId: "tenant",
      workspaceId: "workspace",
      resolvedAt: "2026-01-01T00:00:00.000Z",
      plugins: [],
      connectionGrants: [],
    }),
    webSearch: async (input) => ({ query: input.query, untrusted: true, results: [] }),
    call,
    emit() {},
    ...overrides,
  };
  const runtime = new DesktopSessionManager(options);
  runtimes.push(runtime);
  const thread = await runtime.create(workspace, "provider", "medium", "on-request", ":workspace", pluginActivations);
  return { runtime, thread, options };
}
async function done(runtime: DesktopSessionManager, id: string) {
  await expect.poll(() => runtime.get(id).status, { timeout: 8000 }).not.toBe("running");
  return runtime.get(id);
}

function reviewedBashCall(): DesktopSessionOptions["call"] {
  const call = vi.fn<DesktopSessionOptions["call"]>();
  return call
    .mockImplementationOnce(async () =>
      reply([
        {
          type: "tool-call",
          toolCallId: "reviewed",
          toolName: "bash",
          input: JSON.stringify({ command: "rm -rf temporary-dir && printf x >> marker.txt" }),
        },
      ]),
    )
    .mockImplementation(async () => reply(text()));
}

function pendingApproval(thread: ReturnType<DesktopSessionManager["get"]>) {
  for (const { parts } of thread.messages) {
    for (const part of parts) if (isToolUIPart(part) && part.state === "approval-requested") return part.approval.id;
  }
  throw new Error("missing approval");
}

function docsSnapshot(): ResolvedTurnPluginSnapshot {
  const manifest: AgentPluginManifest = {
    schemaVersion: 1,
    id: "docs@external",
    version: "1.0.0",
    digest: `sha256:${"a".repeat(64)}`,
    displayName: "Docs",
    description: "External document search",
    source: "external-mcp",
    trust: "unverified",
    mcpServers: [
      {
        name: "docs",
        tools: [
          {
            name: "search",
            description: "Search documents",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            policy: { capability: "external", effect: "read", trust: "open-world", execution: "inline" },
            planning: { summary: "Search knowledge" },
          },
        ],
        url: "https://docs.example/mcp",
      },
    ],
  };
  return {
    schemaVersion: 1,
    snapshotId: "docs-snapshot",
    snapshotDigest: `sha256:${"b".repeat(64)}`,
    workspaceRevision: 1,
    tenantId: "tenant",
    workspaceId: "workspace",
    resolvedAt: "2026-01-01T00:00:00.000Z",
    plugins: [{ manifest, activation: { pluginId: manifest.id } }],
    connectionGrants: [
      {
        pluginId: manifest.id,
        serverName: "docs",
        headers: { Authorization: "Bearer desktop-secret" },
      },
    ],
  };
}

describe.skipIf(process.platform !== "darwin")("local assistant owns execution and recovery", () => {
  it("retries a connection-only model failure three times and reports recovery", async () => {
    let calls = 0;
    const events: DesktopEvent[] = [];
    const f = await fixture(
      async () => {
        calls++;
        if (calls > 3) return reply(text());
        return new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({
              type: "error",
              error: {
                code: "model_connection_failed",
                message: "模型连接被重置",
                retryable: true,
                reason: "connection_reset",
              },
            });
            controller.close();
          },
        });
      },
      { emit: (event) => events.push(event), waitForModelRetry: async () => {} },
    );

    f.runtime.send(f.thread.id, user("first"), randomUUID());
    const completed = await done(f.runtime, f.thread.id);
    expect(completed.status).toBe("idle");
    expect(calls).toBe(4);
    expect(
      events.flatMap((event) =>
        event.type === "stream" && event.chunk?.type === "data-model-retry" ? [event.chunk.data] : [],
      ),
    ).toEqual([
      { state: "retrying", attempt: 1, maxAttempts: 3, reason: "connection_reset" },
      { state: "retrying", attempt: 2, maxAttempts: 3, reason: "connection_reset" },
      { state: "retrying", attempt: 3, maxAttempts: 3, reason: "connection_reset" },
      { state: "recovered", attempt: 3, maxAttempts: 3, reason: "connection_reset" },
    ]);
  });

  it("retries the current model step after partial text without replaying the turn", async () => {
    let calls = 0;
    const f = await fixture(
      async () => {
        calls++;
        if (calls > 1) return reply(text());
        return new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "partial" });
            controller.enqueue({ type: "text-delta", id: "partial", delta: "partial" });
            controller.enqueue({
              type: "error",
              error: {
                code: "model_connection_failed",
                message: "模型连接被重置",
                retryable: true,
                reason: "connection_reset",
              },
            });
            controller.close();
          },
        });
      },
      { waitForModelRetry: async () => {} },
    );

    f.runtime.send(f.thread.id, user("first"), randomUUID());
    const completed = await done(f.runtime, f.thread.id);
    expect(completed.status).toBe("idle");
    expect(calls).toBe(2);
    expect(completed.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("stops after three retries and accepts an explicit next turn without replay", async () => {
    let calls = 0;
    const events: DesktopEvent[] = [];
    const f = await fixture(
      async () => {
        calls++;
        if (calls > 4) return reply(text());
        return new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({
              type: "error",
              error: {
                code: "model_connection_failed",
                message: "模型连接被重置",
                retryable: true,
                reason: "connection_reset",
              },
            });
            controller.close();
          },
        });
      },
      { emit: (event) => events.push(event), waitForModelRetry: async () => {} },
    );

    f.runtime.send(f.thread.id, user("first"), randomUUID());
    const failed = await done(f.runtime, f.thread.id);
    expect(failed.status).toBe("error");
    expect(failed.error).toContain("已重试 3 次");
    expect(calls).toBe(4);
    expect(
      events.flatMap((event) => {
        if (event.type !== "stream" || event.chunk?.type !== "data-model-retry") return [];
        return [(event.chunk.data as { state: string }).state];
      }),
    ).toEqual(["retrying", "retrying", "retrying", "failed"]);

    f.runtime.send(f.thread.id, user("continue"), randomUUID());
    const recovered = await done(f.runtime, f.thread.id);
    expect(recovered.status).toBe("idle");
    expect(calls).toBe(5);
    expect(recovered.messages.filter((message) => message.role === "user")).toHaveLength(2);
  });

  it("does not retry an explicit terminal provider error after model output has started", async () => {
    let calls = 0;
    const f = await fixture(async () => {
      calls++;
      return new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "partial" });
          controller.enqueue({ type: "text-delta", id: "partial", delta: "partial" });
          controller.enqueue({
            type: "error",
            error: {
              code: "model_stream_interrupted",
              message: "模型响应协议错误，请重新发送消息",
              retryable: false,
              reason: "protocol",
            },
          });
          controller.close();
        },
      });
    });

    f.runtime.send(f.thread.id, user("first"), randomUUID());
    const failed = await done(f.runtime, f.thread.id);
    expect(failed.status).toBe("error");
    expect(failed.error).toContain("模型响应协议错误");
    expect(calls).toBe(1);
  });

  it("retries compaction before reopening a completed tool step while the next sample is still running", async () => {
    let resume: () => void = () => {};
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let samples = 0;
    let compactionCalls = 0;
    const events: DesktopEvent[] = [];
    const f = await fixture(
      async (request) => {
        if (JSON.stringify(request.options.prompt).includes("Compress the older transcript prefix")) {
          compactionCalls++;
          if (compactionCalls === 1) {
            return new ReadableStream<LanguageModelV4StreamPart>({
              start(controller) {
                controller.enqueue({
                  type: "error",
                  error: {
                    code: "model_connection_failed",
                    message: "模型连接被重置",
                    retryable: true,
                    reason: "connection_reset",
                  },
                });
                controller.close();
              },
            });
          }
          return reply([
            { type: "text-start", id: "s" },
            { type: "text-delta", id: "s", delta: "saved evidence" },
            { type: "text-end", id: "s" },
          ]);
        }
        if (++samples === 1)
          return reply([
            {
              type: "tool-call",
              toolName: "read_file",
              toolCallId: "durable-read",
              input: JSON.stringify({ path: "evidence.txt" }),
            },
          ]);
        await resumed;
        return reply(text());
      },
      {
        config: async () => ({
          providerId: "provider",
          providerName: "test",
          reasoningEffort: "medium",
          model: "test",
          contextWindow: 10_000,
          maxOutputTokens: 1_000,
          instructions: "",
        }),
        emit: (event) => events.push(event),
        waitForModelRetry: async () => {},
      },
    );
    await writeFile(join(f.thread.workspace, "evidence.txt"), "evidence ".repeat(1500));
    f.runtime.send(f.thread.id, user("read evidence"), randomUUID());
    const reader = new LocalJournal(f.options.directory);
    try {
      await expect.poll(() => reader.getCheckpoint(f.thread.id)?.state.version).toBe("step-compaction-v1");
      await expect.poll(() => JSON.stringify(reader.get(f.thread.id).messages)).toContain('"state":"output-available"');
      expect(reader.get(f.thread.id).status).toBe("running");
    } finally {
      resume();
      reader.close();
    }
    expect((await done(f.runtime, f.thread.id)).status).toBe("idle");
    expect(compactionCalls).toBe(2);
    expect(
      events.flatMap((event) =>
        event.type === "stream" && event.chunk?.type === "data-model-retry" ? [event.chunk.data] : [],
      ),
    ).toEqual([
      { state: "retrying", attempt: 1, maxAttempts: 3, reason: "connection_reset" },
      { state: "recovered", attempt: 1, maxAttempts: 3, reason: "connection_reset" },
    ]);
    expect(
      events.flatMap((event) =>
        event.type === "stream" && event.chunk?.type === "data-context-compaction" ? [event.chunk.data] : [],
      ),
    ).toEqual([
      { state: "started", phase: "step" },
      { state: "completed", phase: "step" },
    ]);
    expect(events.some((event) => event.type === "stream" && event.chunk?.type === "data-context-usage")).toBe(true);
  });

  it("persists model binding updates and freezes them for the active turn", async () => {
    const f = await fixture(async () => reply(text()));

    f.runtime.setModelBinding(f.thread.id, "provider-2", "high");
    expect(f.runtime.get(f.thread.id)).toMatchObject({ providerId: "provider-2", reasoningEffort: "high" });
    expect(f.runtime.journal.get(f.thread.id)).toMatchObject({ providerId: "provider-2", reasoningEffort: "high" });

    f.runtime.send(f.thread.id, user("run"), randomUUID());
    expect(() => f.runtime.setModelBinding(f.thread.id, "provider", "low")).toThrow("当前轮次的模型与推理深度已冻结");
    await done(f.runtime, f.thread.id);
  });

  it("loads an installed local Codex skill alongside the Admin selection in one frozen turn", async () => {
    const platform = docsSnapshot();
    const resolvePlatform = vi.fn(async () => platform);
    const requests: InferenceRequest[] = [];
    const f = await fixture(
      async (request) => {
        requests.push(request);
        return reply(
          requests.length === 1
            ? [
                {
                  type: "tool-call",
                  toolCallId: "skill",
                  toolName: "load_skill",
                  input: JSON.stringify({ name: "writing@local:proofread" }),
                },
              ]
            : text(),
        );
      },
      { resolvePlugins: resolvePlatform },
      [{ pluginId: platform.plugins[0].manifest.id }, { origin: "local", pluginId: "writing@local" }],
    );
    const root = join(f.thread.workspace, "writing-source");
    await mkdir(join(root, ".codex-plugin"), { recursive: true });
    await mkdir(join(root, "skills", "proofread"), { recursive: true });
    await writeFile(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "writing", version: "1.0.0" }));
    await writeFile(
      join(root, "skills/proofread/SKILL.md"),
      "---\nname: proofread\ndescription: Review spelling\n---\nUse the local spelling guide.",
    );
    const installed = await importLocalPlugin(f.options.directory, root);
    expect(await listLocalPlugins(f.options.directory)).toEqual([installed]);
    await rm(root, { recursive: true });
    f.runtime.send(f.thread.id, user("proofread"), randomUUID());
    const thread = await done(f.runtime, f.thread.id);
    expect(thread.status).toBe("idle");
    const snapshot = f.runtime.journal.getPluginSnapshot(thread.turnId!);
    expect(snapshot?.plugins.map(({ manifest }) => manifest.id)).toEqual([
      platform.plugins[0].manifest.id,
      "writing@local",
    ]);
    expect(JSON.stringify(requests[0]?.options.prompt)).toContain("writing@local:proofread");
    expect(JSON.stringify(requests[1]?.options.prompt)).toContain("Use the local spelling guide.");
    expect(JSON.stringify(resolvePlatform.mock.calls)).not.toContain("writing@local");
  });

  it("freezes plugin tools for the Turn, persists only the audit snapshot and disposes resources", async () => {
    const requests: InferenceRequest[] = [];
    const dispose = vi.fn(async () => {});
    const snapshot = docsSnapshot();
    const manifest = snapshot.plugins[0].manifest;
    const f = await fixture(
      async (request) => {
        requests.push(request);
        return reply(
          requests.length === 1
            ? [
                {
                  type: "tool-call",
                  toolCallId: "discover-docs",
                  toolName: "tool_search",
                  input: JSON.stringify({ query: "document search" }),
                },
              ]
            : text(),
        );
      },
      {
        resolvePlugins: async () => snapshot,
        pluginLoader: {
          load: async () => ({
            snapshotId: snapshot.snapshotId,
            snapshotDigest: snapshot.snapshotDigest,
            activePlugins: [manifest],
            skills: [],
            manifests: [
              defineAgentTool(
                "mcp__docs__search",
                tool({
                  description: "Search knowledge",
                  inputSchema: z.object({}),
                  execute: async () => ({ results: [] }),
                }),
                {
                  capability: "external",
                  effect: "read",
                  trust: "open-world",
                  execution: "inline",
                  source: "mcp",
                  pluginId: manifest.id,
                },
                { summary: "Search knowledge" },
              ),
            ],
            dispose,
          }),
        },
      },
      [{ pluginId: manifest.id }],
    );

    f.runtime.send(f.thread.id, user("search"), randomUUID());
    expect((await done(f.runtime, f.thread.id)).status).toBe("idle");
    expect(requests).toHaveLength(2);
    expect(requests[0].options.tools?.map((candidate) => candidate.name)).not.toContain("mcp__docs__search");
    expect(requests[1].options.tools?.map((candidate) => candidate.name)).toContain("mcp__docs__search");
    const persisted = f.runtime.journal.getPluginSnapshot(f.runtime.get(f.thread.id).turnId!);
    expect(persisted?.plugins[0]?.manifest.id).toBe(manifest.id);
    expect(JSON.stringify(persisted)).not.toContain("desktop-secret");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("does not invent workspace changes for a capability question", async () => {
    const requests: InferenceRequest[] = [];
    const f = await fixture(async (request) => {
      requests.push(request);
      return reply(text());
    });
    f.runtime.send(f.thread.id, user("你能帮我干啥？"), randomUUID());
    expect((await done(f.runtime, f.thread.id)).status).toBe("idle");
    expect(requests).toHaveLength(1);
    const initialTools = requests[0].options.tools?.map((candidate) => candidate.name) ?? [];
    expect(initialTools).toEqual(
      expect.arrayContaining(["bash", "read_file", "apply_patch", "write_file", "tool_search"]),
    );
    expect(initialTools).not.toContain("subagents");
    expect(initialTools).not.toContain("code_mode");
    expect(JSON.stringify(requests[0].options.prompt)).not.toContain("工作区内容已变化");
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
    f.runtime.send(f.thread.id, user("查看文件"), randomUUID());
    expect((await done(f.runtime, f.thread.id)).status).toBe("idle");
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[0].options.prompt)).toContain("external.txt");
    for (const request of requests.slice(1))
      expect(JSON.stringify(request.options.prompt)).not.toContain("工作区内容已变化");
  });

  it("keeps later tool calls valid after an earlier call mutates the same workspace", async () => {
    const requests: InferenceRequest[] = [];
    const f = await fixture(async (request) => {
      requests.push(request);
      return reply(
        requests.length === 1
          ? [
              {
                type: "tool-call",
                toolCallId: "first-write",
                toolName: "bash",
                input: JSON.stringify({ command: "printf first > first.txt" }),
              },
              {
                type: "tool-call",
                toolCallId: "second-write",
                toolName: "bash",
                input: JSON.stringify({ command: "printf second > second.txt" }),
              },
            ]
          : text(),
      );
    });

    f.runtime.send(f.thread.id, user("write both files"), randomUUID());
    const completed = await done(f.runtime, f.thread.id);

    expect(completed.status).toBe("idle");
    expect(await readFile(join(f.thread.workspace, "first.txt"), "utf8")).toBe("first");
    expect(await readFile(join(f.thread.workspace, "second.txt"), "utf8")).toBe("second");
    expect(JSON.stringify(completed.messages)).not.toContain("工作区在推理后发生变化");
    const nextPrompt = JSON.stringify(requests[1]?.options.prompt);
    expect(nextPrompt).toContain('runtime_context type=\\"workspace_changes\\"');
    expect(nextPrompt).toContain("first.txt");
    expect(nextPrompt).toContain("second.txt");
  });

  it("retains a real PTY between turns and isolates its handle from another thread sharing the workspace", async () => {
    let nextCall: LanguageModelV4StreamPart | undefined = {
      type: "tool-call",
      toolCallId: "open",
      toolName: "bash",
      input: JSON.stringify({ command: "cat", tty: true, yield_time_ms: 250 }),
    };
    const f = await fixture(async () => {
      const call = nextCall;
      nextCall = undefined;
      return reply(call ? [call] : text());
    });
    f.runtime.send(f.thread.id, user("打开终端"), randomUUID());
    const first = await done(f.runtime, f.thread.id);
    const opened = first.messages
      .flatMap((message) => message.parts)
      .find((part) => isToolUIPart(part) && part.toolCallId === "open");
    if (!opened || !isToolUIPart(opened) || opened.state !== "output-available") throw new Error("missing exec result");
    const { data } = opened.output as { data: { session_id: number } };
    expect(data.session_id).toEqual(expect.any(Number));
    const other = await f.runtime.create(f.thread.workspace, "provider", "medium", "on-request", ":workspace", []);
    const write = (id: string, stdin: string): LanguageModelV4StreamPart => ({
      type: "tool-call",
      toolCallId: id,
      toolName: "bash",
      input: JSON.stringify({ session_id: data.session_id, stdin, yield_time_ms: 250 }),
    });
    nextCall = write("other", "foreign\n");
    f.runtime.send(other.id, user("尝试另一个会话的终端"), randomUUID());
    expect(JSON.stringify((await done(f.runtime, other.id)).messages)).toContain("Unknown process session");
    nextCall = write("resume", "same-thread\n\u0004");
    f.runtime.send(f.thread.id, user("继续终端"), randomUUID());
    const resumed = (await done(f.runtime, f.thread.id)).messages
      .flatMap((message) => message.parts)
      .find((part) => isToolUIPart(part) && part.toolCallId === "resume");
    expect(resumed).toMatchObject({
      state: "output-available",
      output: { data: { exit_code: 0, output: expect.stringContaining("same-thread") } },
    });
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
    f.runtime.send(f.thread.id, user("create"), randomUUID());
    expect((await done(f.runtime, f.thread.id)).status).toBe("idle");
    expect(await readFile(join(f.thread.workspace, "demo.js"), "utf8")).toBe("one");
    let edited = false;
    f.options.emit = (event) => {
      if (event.type === "files" && event.paths.includes("demo.js")) edited = true;
    };
    await writeFile(join(f.thread.workspace, "demo.js"), "user edited");
    await expect.poll(() => edited).toBe(true);
    f.runtime.send(f.thread.id, user("check edits"), randomUUID());
    expect((await done(f.runtime, f.thread.id)).status).toBe("idle");
    const nextPromptText =
      requests
        .at(-1)
        ?.options.prompt.flatMap((message) =>
          typeof message.content === "string"
            ? [message.content]
            : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
        )
        .join("\n") ?? "";
    expect(nextPromptText).toContain('<runtime_context type="workspace_changes">');
    expect(nextPromptText).toContain("demo.js");
    await f.runtime.close();
    runtimes.splice(runtimes.indexOf(f.runtime), 1);
    const reopened = new DesktopSessionManager(f.options);
    runtimes.push(reopened);
    expect(reopened.get(f.thread.id).messages.filter((message) => message.role === "user")).toHaveLength(2);
    expect(await readFile(join(f.thread.workspace, "demo.js"), "utf8")).toBe("user edited");
  });

  it("executes model-visible read, CAS overwrite, and patch tools through the Seatbelt file worker", async () => {
    const requests: InferenceRequest[] = [];
    const alphaHash = createHash("sha256").update("alpha\n").digest("hex");
    const f = await fixture(async (request) => {
      requests.push(request);
      switch (requests.length) {
        case 1:
          return reply([
            {
              type: "tool-call",
              toolCallId: "seed-file",
              toolName: "bash",
              input: JSON.stringify({ command: "printf 'alpha\\n' > notes.txt" }),
            },
          ]);
        case 2:
          return reply([
            {
              type: "tool-call",
              toolCallId: "read-alpha",
              toolName: "read_file",
              input: JSON.stringify({ path: "notes.txt" }),
            },
          ]);
        case 3:
          return reply([
            {
              type: "tool-call",
              toolCallId: "overwrite-beta",
              toolName: "write_file",
              input: JSON.stringify({
                path: "notes.txt",
                content: "beta\n",
                mode: "overwrite",
                expected_sha256: alphaHash,
              }),
            },
          ]);
        case 4:
          return reply([
            {
              type: "tool-call",
              toolCallId: "read-beta",
              toolName: "read_file",
              input: JSON.stringify({ path: "notes.txt" }),
            },
          ]);
        case 5:
          return reply([
            {
              type: "tool-call",
              toolCallId: "patch-gamma",
              toolName: "apply_patch",
              input: JSON.stringify("*** Begin Patch\n*** Update File: notes.txt\n@@\n-beta\n+gamma\n*** End Patch"),
            },
          ]);
        default:
          return reply(text());
      }
    });

    f.runtime.send(f.thread.id, user("safely update the file"), randomUUID());
    const completed = await done(f.runtime, f.thread.id);

    expect(completed.status).toBe("idle");
    expect(requests).toHaveLength(6);
    expect(JSON.stringify(requests[2].options.prompt)).toContain(alphaHash);
    expect(JSON.stringify(requests[2].options.prompt)).toContain("alpha");
    expect(await readFile(join(f.thread.workspace, "notes.txt"), "utf8")).toBe("gamma\n");
    expect(JSON.stringify(completed.messages)).toContain('"type":"tool-read_file"');
    expect(JSON.stringify(completed.messages)).toContain('"type":"tool-write_file"');
    expect(JSON.stringify(completed.messages)).toContain('"type":"tool-apply_patch"');
  });

  it.each([false, true])("resumes the approved call with its frozen snapshot (restart=%s)", async (restart) => {
    const f = await fixture(reviewedBashCall());
    const id = f.thread.id;
    f.runtime.send(id, user("clean up"), randomUUID());
    const waiting = await done(f.runtime, id);
    expect(waiting.status).toBe("waiting");
    const approvalId = pendingApproval(waiting);
    const snapshot = f.runtime.journal.getPluginSnapshot(waiting.turnId!);
    let runtime = f.runtime;
    if (restart) {
      await runtime.close();
      runtimes.splice(runtimes.indexOf(runtime), 1);
      runtime = new DesktopSessionManager(f.options);
      runtimes.push(runtime);
    }
    runtime.approve(id, approvalId, true);
    const completed = await done(runtime, id);
    expect(completed.error).toBeNull();
    expect(completed.status).toBe("idle");
    expect(runtime.journal.getPluginSnapshot(waiting.turnId!)).toEqual(snapshot);
    expect(await readFile(join(f.thread.workspace, "marker.txt"), "utf8")).toBe("x");
  });

  it.each([false, true])("refreshes grants only for the frozen MCP configuration (changed=%s)", async (changed) => {
    const original = docsSnapshot();
    const refreshed = structuredClone(original);
    refreshed.snapshotId = randomUUID();
    refreshed.connectionGrants = [{ ...original.connectionGrants[0], headers: { Authorization: "fresh grant" } }];
    if (changed) refreshed.workspaceId = "another-workspace";
    const resolver = vi
      .fn<DesktopSessionOptions["resolvePlugins"]>()
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(refreshed);
    const load = vi.fn(async (snapshot: ResolvedTurnPluginSnapshot) => ({
      snapshotId: snapshot.snapshotId,
      snapshotDigest: snapshot.snapshotDigest,
      activePlugins: [],
      skills: [],
      manifests: [],
      dispose: async () => {},
    }));
    const f = await fixture(
      reviewedBashCall(),
      { resolvePlugins: resolver, pluginLoader: { load } },
      original.plugins.map((plugin) => plugin.activation),
    );
    f.runtime.send(f.thread.id, user("run"), randomUUID());
    const waiting = await done(f.runtime, f.thread.id);
    const approvalId = pendingApproval(waiting);
    f.runtime.approve(f.thread.id, approvalId, true);
    const completed = await done(f.runtime, f.thread.id);
    const marker = join(f.thread.workspace, "marker.txt");
    if (changed) {
      expect(completed.status).toBe("error");
      expect(load).toHaveBeenCalledTimes(1);
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect(completed.error).toBeNull();
      expect(await readFile(marker, "utf8")).toBe("x");
      expect(load.mock.calls[1]?.[0]).toMatchObject({
        snapshotId: original.snapshotId,
        connectionGrants: refreshed.connectionGrants,
      });
    }
    expect(f.runtime.journal.getPluginSnapshot(waiting.turnId!)).not.toHaveProperty("connectionGrants");
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
    f.runtime.send(f.thread.id, user("run"), randomUUID());
    const completed = await done(f.runtime, f.thread.id);
    expect(completed.status).toBe("idle");
    expect(await readFile(join(f.thread.workspace, "result.txt"), "utf8")).toBe("allowed");
    const part = completed.messages.flatMap((message) => message.parts).find((part) => isToolUIPart(part));
    expect(part).toMatchObject({
      state: "output-available",
      toolMetadata: { agent: { uiKind: "terminal" } },
      output: {
        ok: true,
        status: "completed",
        data: { exit_code: 0, output: "" },
      },
    });
    expect(calls).toBe(2);
  });

  it("reads selected files in Seatbelt, preserves the reference across restart and isolates other sessions", async () => {
    let source = "";
    const token = randomUUID();
    const requests: InferenceRequest[] = [];
    const f = await fixture(async (request) => {
      requests.push(request);
      const toolName = requests.length === 1 ? "read_file" : "bash";
      const input = toolName === "read_file" ? { path: source } : { command: `/bin/cat "${source}"` };
      return requests.length <= 2
        ? reply([{ type: "tool-call", toolCallId: randomUUID(), toolName, input: JSON.stringify(input) }])
        : reply(text());
    });
    const { id, workspace } = f.thread;
    const workspacePath = join(workspace, "notes.txt");
    await writeFile(workspacePath, "original");
    expect(await f.runtime.workspaceFilePath(id, workspacePath)).toBe("notes.txt");
    const outside = join(f.options.directory, "..", "outside.txt");
    await writeFile(outside, "selected outside the project");
    expect(await f.runtime.workspaceFilePath(id, outside)).toBeNull();
    const bytes = Buffer.from(token);
    source = await f.runtime.importAttachment(id, "notes.txt", bytes);
    expect(await f.runtime.importAttachment(id, "notes.txt", bytes)).toBe(source);
    const second = await f.runtime.importAttachment(id, "notes.txt", Buffer.from("different"));
    expect(second).not.toBe(source);
    await f.runtime.setExecutionPolicy(id, "on-request", ":read-only");
    f.runtime.send(id, user(JSON.stringify(source)), randomUUID());
    expect((await done(f.runtime, id)).status).toBe("idle");
    expect(JSON.stringify(requests[0].options.prompt)).not.toContain(token);
    expect(JSON.stringify(requests[1].options.prompt)).toContain(token);
    const steps = f.runtime.get(id).messages.flatMap((m) => m.parts);
    const command = steps.find((p) => p.type === "tool-bash");
    expect(JSON.stringify(command)).toContain(token);
    expect(f.runtime.journal.get(id).messages[0]?.parts).toEqual(user(JSON.stringify(source)));
    await f.runtime.close();
    runtimes.splice(runtimes.indexOf(f.runtime), 1);
    const reopened = new DesktopSessionManager(f.options);
    runtimes.push(reopened);
    expect(reopened.get(id).messages[0]?.parts).toEqual(user(JSON.stringify(source)));
    expect(await reopened.file(id, { operation: "read", path: source })).toMatchObject({ content: token });
    const other = await reopened.create(workspace, "provider", "medium", "on-request", ":workspace", []);
    await expect(reopened.file(other.id, { operation: "read", path: source })).rejects.toThrow();
    const pending = reopened.importAttachment(id, "last.txt", Buffer.from("pending"));
    await Promise.allSettled([pending, reopened.remove(id)]);
    await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(workspacePath, "utf8")).toBe("original");
  });

  it("publishes a local workspace file as the shared inline artifact part", async () => {
    let calls = 0;
    const requests: InferenceRequest[] = [];
    const f = await fixture(async (request) => {
      requests.push(request);
      calls += 1;
      if (calls === 1) {
        return reply([
          {
            type: "tool-call",
            toolCallId: "write",
            toolName: "bash",
            input: JSON.stringify({ command: "touch draft.txt && printf 'export default 1' > demo.js" }),
          },
        ]);
      }
      if (calls === 2)
        return reply([
          {
            type: "tool-call",
            toolCallId: "deliver",
            toolName: "upload_artifacts",
            input: JSON.stringify({ paths: ["demo.js"] }),
          },
        ]);
      return reply(text());
    });
    f.runtime.send(f.thread.id, user("create"), randomUUID());
    const completed = await done(f.runtime, f.thread.id);
    expect(completed.status).toBe("idle");
    expect(calls).toBe(3);
    expect(requests[0]?.options.tools?.map((candidate) => candidate.name)).toContain("upload_artifacts");
    expect(
      completed.messages.flatMap((message) => message.parts).filter((part) => part.type === "data-file"),
    ).toHaveLength(1);
    expect(
      completed.messages.flatMap((message) => message.parts).find((part) => part.type === "data-file"),
    ).toMatchObject({
      type: "data-file",
      data: {
        file_id: expect.stringMatching(/^[a-f0-9]{32}$/),
        filename: "demo.js",
        title: "demo.js",
        media_type: "text/javascript",
        kind: "artifact",
        etag: expect.stringMatching(/^"[a-f0-9]{32}"$/),
        updated: false,
        workspace_path: "demo.js",
      },
    });
  });

  it("admits a running supplement into the next SDK step and persists the official part", async () => {
    const requests: InferenceRequest[] = [];
    const f = await fixture(async (request) => {
      requests.push(request);
      return reply(
        requests.length === 1
          ? [
              {
                type: "tool-call",
                toolCallId: "pause",
                toolName: "bash",
                input: JSON.stringify({ command: "sleep 0.2" }),
              },
            ]
          : text(),
      );
    });
    f.runtime.send(f.thread.id, user("start"), randomUUID());
    await expect.poll(() => requests.length).toBe(1);
    const active = f.runtime.get(f.thread.id);
    expect(active.turnId).toBeTruthy();
    const messageId = randomUUID();
    expect(
      f.runtime.submitRunInput(f.thread.id, active.turnId!, "use the updated requirement", messageId, "follow-up"),
    ).toEqual({
      admission: "accepted",
      turnId: active.turnId,
    });

    const completed = await done(f.runtime, f.thread.id);
    expect(JSON.stringify(requests[1]?.options.prompt)).toContain("use the updated requirement");
    expect(
      completed.messages.flatMap((message) => message.parts).find((part) => part.type === "steering-message"),
    ).toMatchObject({
      type: "steering-message",
      id: messageId,
      parts: [{ type: "text", text: "use the updated requirement" }],
    });
    expect(completed.pendingInputs).toEqual([]);
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
    f.runtime.send(f.thread.id, user("wait"), randomUUID());
    await expect.poll(() => f.runtime.openStream(f.thread.id).segment).not.toBe(null);
    const active = f.runtime.get(f.thread.id);
    const supplementId = randomUUID();
    f.runtime.submitRunInput(f.thread.id, active.turnId!, "do not replay me as a new turn", supplementId, "follow-up");
    await f.runtime.stop(f.thread.id);
    expect(f.runtime.get(f.thread.id).status).toBe("cancelled");
    const interrupted = f.runtime.get(f.thread.id);
    expect(interrupted.pendingInputs).toContainEqual(
      expect.objectContaining({ id: supplementId, state: "not_delivered", reason: "aborted" }),
    );
    expect(interrupted.messages.filter((message) => message.role === "user")).toHaveLength(1);
    interrupted.status = "running";
    f.runtime.journal.save(interrupted);
    await f.runtime.close();
    runtimes.splice(runtimes.indexOf(f.runtime), 1);
    const reopened = new DesktopSessionManager(f.options);
    runtimes.push(reopened);
    expect(reopened.get(f.thread.id).status).toBe("interrupted");
  });
});
