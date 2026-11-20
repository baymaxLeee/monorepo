import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type {
  AgentPluginManifest,
  PluginActivation,
  ResolvedTurnPluginSnapshot,
} from "@repo/agent-runtime/plugins/types";
import { defineAgentTool } from "@repo/agent-runtime/tools/manifest";
import { isToolUIPart, tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { InferenceRequest } from "../contracts/inference.generated";
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
  overrides: Partial<Pick<DesktopSessionOptions, "pluginLoader" | "resolvePlugins">> = {},
  pluginActivations: PluginActivation[] = [],
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
          input: JSON.stringify({ command: "rm -f temporary.txt && printf x >> marker.txt" }),
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
  it("persists model binding updates and freezes them for the active turn", async () => {
    const f = await fixture(async () => reply(text()));

    f.runtime.setModelBinding(f.thread.id, "provider-2", "high");
    expect(f.runtime.get(f.thread.id)).toMatchObject({ providerId: "provider-2", reasoningEffort: "high" });
    expect(f.runtime.journal.get(f.thread.id)).toMatchObject({ providerId: "provider-2", reasoningEffort: "high" });

    f.runtime.send(f.thread.id, user("run"), randomUUID());
    expect(() => f.runtime.setModelBinding(f.thread.id, "provider", "low")).toThrow("当前轮次的模型与推理深度已冻结");
    await done(f.runtime, f.thread.id);
  });

  it("freezes plugin tools for the Turn, persists only the audit snapshot and disposes resources", async () => {
    const requests: InferenceRequest[] = [];
    const dispose = vi.fn(async () => {});
    const snapshot = docsSnapshot();
    const manifest = snapshot.plugins[0]!.manifest;
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
    expect(requests[0]!.options.tools?.map((candidate) => candidate.name)).not.toContain("mcp__docs__search");
    expect(requests[1]!.options.tools?.map((candidate) => candidate.name)).toContain("mcp__docs__search");
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
    const initialTools = requests[0]!.options.tools?.map((candidate) => candidate.name) ?? [];
    expect(initialTools).toEqual(
      expect.arrayContaining(["bash", "read_file", "apply_patch", "write_file", "tool_search"]),
    );
    expect(initialTools).not.toContain("subagents");
    expect(initialTools).not.toContain("code_mode");
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
    f.runtime.send(f.thread.id, user("查看文件"), randomUUID());
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
              input: JSON.stringify({
                patch: "*** Begin Patch\n*** Update File: notes.txt\n@@\n-beta\n+gamma\n*** End Patch",
              }),
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
    expect(JSON.stringify(requests[2]!.options.prompt)).toContain(alphaHash);
    expect(JSON.stringify(requests[2]!.options.prompt)).toContain("alpha");
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
    refreshed.connectionGrants = [{ ...original.connectionGrants[0]!, headers: { Authorization: "fresh grant" } }];
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
        data: { termination: { type: "exit", exitCode: 0 }, stdout: "", stderr: "" },
      },
    });
    expect(calls).toBe(2);
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
