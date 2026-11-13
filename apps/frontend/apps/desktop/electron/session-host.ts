import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentHarness } from "@backend/agent-runtime-ts";
import { createBashTool } from "@backend/agent-runtime-ts/bash";
import { manifestsToTools } from "@backend/agent-runtime-ts/manifest";
import { createToolApprovalPolicy } from "@backend/agent-runtime-ts/policy";
import {
  convertToModelMessages,
  isToolUIPart,
  readUIMessageStream,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

import type { DesktopEvent, LocalThread } from "../contracts/bridge.generated";
import type { InferenceConfig } from "../contracts/inference.generated";
import { terminalize } from "./interrupted";
import { LocalJournal } from "./journal";
import { relayModel, type RelayCall } from "./relay-model";
import { LocalSandbox, type SandboxOptions } from "./sandbox";

export interface SessionHostOptions {
  directory: string;
  controlDirectory: string;
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

export class LocalSessionHost {
  readonly journal: LocalJournal;
  private workspaces = new Map<string, Promise<Workspace>>();
  private active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  private closed = false;
  private segments = new Map<string, { id: string; messages: UIMessage[]; chunks: UIMessageChunk[]; done: boolean }>();
  private current = new Map<string, LocalThread>();
  private observedWorkspaceEpochs = new Map<string, number>();
  constructor(private readonly options: SessionHostOptions) {
    this.journal = new LocalJournal(options.directory);
    for (const metadata of this.journal.list())
      if (metadata.status === "running") {
        const thread = this.journal.get(metadata.id);
        thread.status = "interrupted";
        thread.error = "应用上次异常退出；未完成的工具不会自动重放";
        thread.messages = terminalize(thread.messages, thread.error);
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
          protectedPaths: [this.options.controlDirectory],
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
  approve(id: string, approvalId: string, approved: boolean) {
    if (this.active.has(id)) throw new Error("会话仍在执行");
    const thread = this.get(id);
    if (thread.status !== "waiting") throw new Error("审批已过期");
    let found = false;
    thread.messages = thread.messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) => {
        if (!isToolUIPart(part) || part.state !== "approval-requested" || part.approval.id !== approvalId) return part;
        found = true;
        return { ...part, state: "approval-responded" as const, approval: { ...part.approval, approved } };
      }),
    }));
    if (!found) throw new Error("审批不存在或已处理");
    this.save(thread);
    if (
      !thread.messages.some((message) =>
        message.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested"),
      )
    )
      this.start(thread);
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
    const done = Promise.resolve().then(() => this.run(thread, abort.signal));
    this.active.set(thread.id, { abort, done });
    void done
      .finally(() => {
        this.active.delete(thread.id);
        this.current.delete(thread.id);
      })
      .catch(() => undefined);
  }
  private async run(thread: LocalThread, signal: AbortSignal) {
    let workspace: Workspace | undefined;
    try {
      workspace = await this.workspace(thread);
      const config = await this.options.config(thread.agentId, signal);
      let modelEpoch = workspace.epoch;
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
      const result = await agent.stream({ messages: await convertToModelMessages(original), abortSignal: signal });
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
          transform: (chunk, controller) => {
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
      thread.messages = terminalize(thread.messages, thread.error);
    } finally {
      this.active.get(thread.id)?.abort.abort();
      workspace?.sandbox.cancel();
      if (workspace) await workspace.queue;
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
      thread.messages = terminalize(thread.messages, thread.error);
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
