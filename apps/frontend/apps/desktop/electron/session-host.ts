import { createHash, randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { createAgentHarness } from "@backend/agent-runtime-ts";
import type { PublishedWorkspaceFile } from "@backend/agent-runtime-ts/artifact";
import { createBashTool } from "@backend/agent-runtime-ts/bash";
import {
  applyToolApprovalResponse,
  finalizeInterruptedMessages,
  hasPendingToolApprovals,
} from "@backend/agent-runtime-ts/lifecycle";
import { manifestsToTools } from "@backend/agent-runtime-ts/manifest";
import { createToolApprovalPolicy } from "@backend/agent-runtime-ts/policy";
import { createAgentSteering, type AgentSteering } from "@backend/agent-runtime-ts/steering";
import {
  convertToModelMessages,
  isToolUIPart,
  readUIMessageStream,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

import type { DesktopEvent, LocalPendingInput, LocalThread } from "../contracts/bridge.generated";
import type { InferenceConfig } from "../contracts/inference.generated";
import { LocalJournal } from "./journal";
import { relayModel, type RelayCall } from "./relay-model";
import { LocalSandbox, type SandboxOptions } from "./sandbox";

function localWorkspacePath(root: string, value: string): string {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const path = relative(root, absolute);
  if (!path || path === ".." || path.startsWith("../") || isAbsolute(path)) {
    throw new Error("发布文件必须位于授权工作目录内");
  }
  return path;
}

function publishedArtifacts(messages: UIMessage[]): Map<string, PublishedWorkspaceFile> {
  const artifacts = new Map<string, PublishedWorkspaceFile>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "data-file" || !part.data || typeof part.data !== "object") continue;
      const value = part.data as unknown as PublishedWorkspaceFile;
      if (typeof value.file_id === "string" && typeof value.workspace_path === "string") {
        artifacts.set(value.file_id, value);
      }
    }
  }
  return artifacts;
}

function mediaType(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return (
    {
      css: "text/css",
      csv: "text/csv",
      html: "text/html",
      js: "text/javascript",
      json: "application/json",
      jsx: "text/jsx",
      md: "text/markdown",
      pdf: "application/pdf",
      png: "image/png",
      svg: "image/svg+xml",
      ts: "text/typescript",
      tsx: "text/tsx",
      txt: "text/plain",
      webp: "image/webp",
      yaml: "application/yaml",
      yml: "application/yaml",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

export interface SessionHostOptions {
  directory: string;
  legacyDirectories?: string[];
  controlDirectories: string[];
  supervisor: string;
  executable: string;
  fileWorker: string;
  config(agentId: string | null, signal: AbortSignal): Promise<InferenceConfig>;
  call: RelayCall;
  emit(event: DesktopEvent): void;
}
interface Workspace {
  sandbox: LocalSandbox;
  scratch: string;
  watcher: FSWatcher;
  changed: Map<string, number>;
  queue: Promise<unknown>;
  epoch: number;
}
interface ActiveRun {
  abort: AbortController;
  done: Promise<void>;
  steering: AgentSteering;
  settlements: Set<Promise<void>>;
  turnId: string;
}

export class LocalSessionHost {
  readonly journal: LocalJournal;
  private workspaces = new Map<string, Promise<Workspace>>();
  private active = new Map<string, ActiveRun>();
  private closed = false;
  private segments = new Map<string, { id: string; messages: UIMessage[]; chunks: UIMessageChunk[]; done: boolean }>();
  private current = new Map<string, LocalThread>();
  private observedWorkspaceEpochs = new Map<string, number>();
  constructor(private readonly options: SessionHostOptions) {
    this.journal = new LocalJournal(options.directory, options.legacyDirectories);
    for (const metadata of this.journal.list())
      if (metadata.status === "running") {
        const thread = this.journal.get(metadata.id);
        thread.status = "interrupted";
        thread.error = "应用上次异常退出；未完成的工具不会自动重放";
        thread.pendingInputs = thread.pendingInputs.map((input) =>
          input.state === "accepted"
            ? { ...input, state: "unconfirmed", reason: "应用退出前未确认模型是否收到这条补充" }
            : input,
        );
        thread.messages = finalizeInterruptedMessages(thread.messages, thread.error);
        this.journal.save(thread);
      }
  }
  list() {
    return this.journal.list();
  }
  get(id: string) {
    return this.current.get(id) ?? this.journal.get(id);
  }
  private save(thread: LocalThread) {
    thread.updatedAt = new Date().toISOString();
    this.journal.save(thread);
    this.options.emit({ type: "thread", thread: structuredClone(thread) });
  }
  async create(workspace: string, agentId: string | null) {
    if (this.closed) throw new Error("本地运行时正在关闭");
    const thread: LocalThread = {
      id: randomUUID(),
      mode: "local",
      title: "本地会话",
      workspace: await realpath(workspace),
      agentId,
      status: "idle",
      turnId: null,
      error: null,
      updatedAt: new Date().toISOString(),
      pendingInputs: [],
      messages: [],
    };
    await this.workspace(thread);
    this.save(thread);
    return thread;
  }
  private workspace(thread: LocalThread): Promise<Workspace> {
    const previous = this.workspaces.get(thread.workspace);
    if (previous) return previous;
    const promise = (async () => {
      const scratch = await realpath(await mkdtemp(join(tmpdir(), "monorepo-local-")));
      try {
        await mkdir(join(scratch, "bin"));
        await symlink(this.options.executable, join(scratch, "bin/node"));
        const settings: SandboxOptions = {
          ...this.options,
          root: thread.workspace,
          scratch,
          protectedPaths: this.options.controlDirectories,
        };
        const sandbox = new LocalSandbox(settings);
        await sandbox.initialize();
        const state: Workspace = {
          sandbox,
          scratch,
          watcher: null as unknown as FSWatcher,
          changed: new Map(),
          queue: Promise.resolve(),
          epoch: 0,
        };
        state.watcher = watch(thread.workspace, { recursive: true }, (_event, filename) => {
          const name = filename?.toString() ?? ".";
          state.epoch++;
          if (state.changed.size < 1000) state.changed.set(name, state.epoch);
          else {
            state.changed.clear();
            state.changed.set(".", state.epoch);
          }
          for (const item of this.journal.list())
            if (item.workspace === thread.workspace)
              this.options.emit({ type: "files", threadId: item.id, paths: [name] });
        });
        state.watcher.on("error", () => {
          state.epoch++;
          state.changed.set(".", state.epoch);
        });
        return state;
      } catch (error) {
        await rm(scratch, { recursive: true, force: true });
        throw error;
      }
    })();
    this.workspaces.set(thread.workspace, promise);
    void promise.catch(() => this.workspaces.delete(thread.workspace));
    return promise;
  }
  private async access<T>(thread: LocalThread, action: (workspace: Workspace) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("本地运行时正在关闭");
    const workspace = await this.workspace(thread);
    const result = workspace.queue.then(() => action(workspace));
    workspace.queue = result.catch(() => undefined);
    return result;
  }
  async file(id: string, operation: Record<string, unknown>) {
    const thread = this.get(id);
    return this.access(thread, (workspace) => workspace.sandbox.file(operation));
  }
  openStream(id: string) {
    return { thread: this.get(id), segment: this.segments.get(id) ?? null };
  }
  send(id: string, text: string, messageId: string) {
    if (this.active.has(id)) throw new Error("当前会话仍在执行");
    if (this.closed) throw new Error("本地运行时正在关闭");
    for (const activeId of this.active.keys())
      if (this.get(activeId).workspace === this.get(id).workspace) throw new Error("同一个工作目录已有会话正在执行");
    const thread = this.get(id);
    if (thread.status === "waiting") throw new Error("请先处理待审批的命令，或停止当前轮次");
    thread.turnId = randomUUID();
    thread.error = null;
    if (thread.messages.length === 0) thread.title = text.slice(0, 80);
    thread.messages.push({ id: messageId, role: "user", parts: [{ type: "text", text }] });
    this.start(thread);
  }
  steer(id: string, expectedTurnId: string, text: string, messageId: string, delivery: LocalPendingInput["delivery"]) {
    if (this.closed) throw new Error("本地运行时正在关闭");
    const thread = this.get(id);
    const existing = thread.pendingInputs.find((input) => input.id === messageId);
    if (existing) {
      if (existing.turnId !== expectedTurnId || existing.text !== text || existing.delivery !== delivery) {
        throw new Error("补充消息标识已绑定到不同的内容或轮次");
      }
      return { admission: "duplicate" as const, turnId: existing.turnId };
    }
    const active = this.active.get(id);
    if (!active || thread.status !== "running") throw new Error("当前轮次已经结束，请作为新消息发送");
    if (active.turnId !== expectedTurnId || thread.turnId !== expectedTurnId) {
      throw new Error("当前轮次已经变化，请刷新后重试");
    }
    const pending: LocalPendingInput = {
      id: messageId,
      turnId: expectedTurnId,
      text,
      delivery,
      state: "accepted",
    };
    thread.pendingInputs.push(pending);
    this.save(thread);
    const outcome = (
      delivery === "queue"
        ? active.steering.queue(text, { id: messageId })
        : active.steering.steer(text, { id: messageId })
    )
      .then((result) => {
        const current = thread.pendingInputs.find((input) => input.id === result.id);
        if (!current) return;
        if (result.type === "delivered") {
          current.state = "delivered";
          current.stepNumber = result.stepNumber;
          current.reason = undefined;
        } else {
          current.state = "not_delivered";
          current.reason = result.reason;
        }
        this.save(thread);
      })
      .finally(() => active.settlements.delete(outcome));
    active.settlements.add(outcome);
    return { admission: "accepted" as const, turnId: expectedTurnId };
  }
  approve(id: string, approvalId: string, approved: boolean) {
    if (this.active.has(id)) throw new Error("会话仍在执行");
    const thread = this.get(id);
    if (thread.status !== "waiting") throw new Error("审批已过期");
    thread.messages = applyToolApprovalResponse(thread.messages, { approvalId, approved });
    this.save(thread);
    if (!hasPendingToolApprovals(thread.messages)) this.start(thread);
  }
  private start(thread: LocalThread) {
    if (this.closed) throw new Error("本地运行时正在关闭");
    for (const id of this.active.keys())
      if (this.get(id).workspace === thread.workspace) throw new Error("同一个工作目录已有会话正在执行");
    this.segments.set(thread.id, {
      id: randomUUID(),
      messages: structuredClone(thread.messages),
      chunks: [],
      done: false,
    });
    thread.status = "running";
    thread.error = null;
    this.current.set(thread.id, thread);
    this.save(thread);
    const abort = new AbortController();
    const steering = createAgentSteering();
    const turnId = thread.turnId;
    if (!turnId) throw new Error("本地轮次缺少标识");
    const settlements = new Set<Promise<void>>();
    const done = Promise.resolve().then(() => this.run(thread, abort.signal, steering, settlements));
    this.active.set(thread.id, { abort, done, steering, settlements, turnId });
    void done
      .finally(() => {
        this.active.delete(thread.id);
        this.current.delete(thread.id);
      })
      .catch(() => undefined);
  }
  private async run(
    thread: LocalThread,
    signal: AbortSignal,
    steering: AgentSteering,
    settlements: Set<Promise<void>>,
  ) {
    let workspace: Workspace | undefined;
    try {
      workspace = await this.workspace(thread);
      const runWorkspace = workspace;
      const config = await this.options.config(thread.agentId, signal);
      let modelEpoch = runWorkspace.epoch;
      const artifactEpoch = runWorkspace.epoch;
      const artifacts = publishedArtifacts(thread.messages);
      const tools = manifestsToTools([
        createBashTool((input, options) =>
          this.access(thread, async (w) => {
            if (w.epoch !== modelEpoch) throw new Error("工作区在推理后发生变化，请重新读取相关输入再执行");
            const result = await w.sandbox.execute(
              "/bin/bash",
              [
                "--noprofile",
                "--norc",
                "-c",
                'cd -- "$1" && eval "$2"',
                "bash",
                input.workdir ?? thread.workspace,
                input.command,
              ],
              undefined,
              options.abortSignal,
            );
            await new Promise<void>((resolve) => {
              setImmediate(resolve);
            });
            return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr };
          }),
        ),
      ]);
      const agent = createAgentHarness({
        model: relayModel(config, this.options.call),
        mode: "normal",
        tools,
        toolApproval: createToolApprovalPolicy("normal"),
        maxOutputTokens: config.maxOutputTokens,
        instructions: `${config.instructions}\n<workspace_environment>${JSON.stringify({ root: thread.workspace, storage: "local disk", network: "disabled", isolation: "Seatbelt", upload: "unavailable" })}</workspace_environment>`,
        workspace: {
          consumeChanges: () => {
            modelEpoch = workspace!.epoch;
            const observed = this.observedWorkspaceEpochs.get(thread.id) ?? 0;
            const changes = [...workspace!.changed].filter(([, epoch]) => epoch > observed).map(([path]) => path);
            this.observedWorkspaceEpochs.set(thread.id, modelEpoch);
            return changes;
          },
        },
      });
      const original = structuredClone(thread.messages);
      const result = await agent.stream({
        messages: await convertToModelMessages(original),
        abortSignal: signal,
        experimental_steering: steering,
      });
      const stream = toUIMessageStream({
        stream: result.stream,
        tools,
        originalMessages: original,
        generateMessageId: randomUUID,
        onError: (error) => (error instanceof Error ? error.message : "本地执行失败"),
      });
      const segment = this.segments.get(thread.id)!;
      let bytes = 0;
      const observed = stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform: async (chunk, controller) => {
            if (chunk.type === "finish") {
              const changed = [...runWorkspace.changed]
                .filter(([, epoch]) => epoch > artifactEpoch)
                .map(([path]) => path)
                .filter((path) => path !== ".")
                .sort();
              for (const candidate of changed) {
                const path = localWorkspacePath(thread.workspace, candidate);
                const inspection = await this.access(thread, (current) =>
                  current.sandbox.file({ operation: "inspect", path }, signal),
                ).catch(() => null);
                if (
                  !inspection ||
                  typeof inspection !== "object" ||
                  !("size" in inspection) ||
                  !Number.isSafeInteger(inspection.size) ||
                  !("etag" in inspection) ||
                  typeof inspection.etag !== "string" ||
                  !/^"[a-f0-9]{32}"$/.test(inspection.etag)
                ) {
                  continue;
                }
                const fileId = createHash("sha256").update(`${thread.id}\0${path}`).digest("hex").slice(0, 32);
                const previous = artifacts.get(fileId);
                const data: PublishedWorkspaceFile = {
                  file_id: fileId,
                  filename: previous?.filename ?? basename(path),
                  title: previous?.title ?? basename(path),
                  media_type: previous?.media_type ?? mediaType(path),
                  kind: previous?.kind ?? (path.toLowerCase().endsWith("-plan.md") ? "plan" : "artifact"),
                  etag: inspection.etag,
                  updated: Boolean(previous),
                  workspace_path: path,
                };
                artifacts.set(fileId, data);
                const file = { type: "data-file", id: fileId, data } as UIMessageChunk;
                bytes += Buffer.byteLength(JSON.stringify(file));
                if (bytes > 16 * 1024 * 1024) throw new Error("当前轮次输出过大，请分步执行");
                segment.chunks.push(file);
                this.options.emit({
                  type: "stream",
                  threadId: thread.id,
                  segmentId: segment.id,
                  index: segment.chunks.length - 1,
                  chunk: file,
                });
                controller.enqueue(file);
              }
            }
            bytes += Buffer.byteLength(JSON.stringify(chunk));
            if (bytes > 16 * 1024 * 1024) throw new Error("当前轮次输出过大，请分步执行");
            segment.chunks.push(chunk);
            this.options.emit({
              type: "stream",
              threadId: thread.id,
              segmentId: segment.id,
              index: segment.chunks.length - 1,
              chunk,
            });
            controller.enqueue(chunk);
          },
        }),
      );
      const last = original.at(-1);
      let lastSaved = 0;
      for await (const message of readUIMessageStream({
        stream: observed,
        message: last?.role === "assistant" ? last : undefined,
        terminateOnError: true,
      })) {
        const index = thread.messages.findIndex((item) => item.id === message.id);
        if (index < 0) thread.messages.push(message);
        else thread.messages[index] = message;
        if (Date.now() - lastSaved > 100) {
          this.save(thread);
          lastSaved = Date.now();
        }
      }
      signal.throwIfAborted();
      thread.status = thread.messages.some((message) =>
        message.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested"),
      )
        ? "waiting"
        : "idle";
    } catch (error) {
      thread.status = signal.aborted ? "cancelled" : "error";
      thread.error = signal.aborted
        ? "已停止，磁盘上的修改仍保留"
        : error instanceof Error
          ? error.message
          : "本地运行失败";
      thread.messages = finalizeInterruptedMessages(thread.messages, thread.error);
    } finally {
      this.active.get(thread.id)?.abort.abort();
      workspace?.sandbox.cancel();
      if (workspace) await workspace.queue;
      await Promise.allSettled([...settlements]);
      thread.pendingInputs = thread.pendingInputs.filter((input) => input.state !== "delivered");
      try {
        this.save(thread);
      } catch {
        this.closed = true;
        this.options.emit({ type: "runtime-error", message: "本地会话记录保存失败；执行已停止，请检查磁盘后重启应用" });
      }
      const segment = this.segments.get(thread.id);
      if (segment) {
        segment.done = true;
        this.options.emit({
          type: "stream",
          threadId: thread.id,
          segmentId: segment.id,
          index: segment.chunks.length,
          chunk: null,
        });
      }
    }
  }
  async stop(id: string) {
    const active = this.active.get(id);
    if (active) {
      active.abort.abort();
      await active.done;
      return;
    }
    const thread = this.get(id);
    if (thread.status === "waiting") {
      thread.status = "cancelled";
      thread.error = "用户停止了待审批轮次";
      thread.messages = finalizeInterruptedMessages(thread.messages, thread.error);
      this.save(thread);
    }
  }
  async remove(id: string) {
    await this.stop(id);
    this.segments.delete(id);
    this.observedWorkspaceEpochs.delete(id);
    this.journal.remove(id);
  }
  private async release(id: string) {
    const pending = this.workspaces.get(id);
    this.workspaces.delete(id);
    if (!pending) return;
    const workspace = await pending.catch(() => null);
    if (!workspace) return;
    workspace.sandbox.cancel();
    await workspace.queue;
    workspace.watcher.close();
    await rm(workspace.scratch, { recursive: true, force: true });
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.active.keys()].map((id) => this.stop(id)));
    await Promise.all([...this.workspaces.keys()].map((id) => this.release(id)));
    this.journal.close();
  }
}
