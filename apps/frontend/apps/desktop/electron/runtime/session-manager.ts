import { createHash, randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { createRuntimeTurn, type RuntimeInputQueue, type RuntimeTurn } from "@repo/agent-runtime";
import { appendWorkspaceChangeEvent } from "@repo/agent-runtime/context/events";
import { projectRuntimeContext } from "@repo/agent-runtime/context/manager";
import { PluginManager } from "@repo/agent-runtime/plugins/manager";
import type {
  AgentPluginContext,
  PluginActivation,
  ResolvedPluginSet,
  ResolvedTurnPluginSnapshot,
} from "@repo/agent-runtime/plugins/types";
import { fileDataChunks, workspaceMediaType, type PublishedWorkspaceFile } from "@repo/agent-runtime/protocol/artifact";
import {
  applyToolApprovalResponse,
  finalizeInterruptedMessages,
  hasPendingToolApprovals,
} from "@repo/agent-runtime/protocol/lifecycle";
import { attachExecutionEnvironment, type ExecutionEnvironment } from "@repo/agent-runtime/runtime/environment";
import { canonicalizeShellCommand, ExecPolicy } from "@repo/agent-runtime/runtime/exec-policy";
import { createExecutionHostManifests } from "@repo/agent-runtime/runtime/execution-host";
import { compilePermissionProfile, type ApprovalPolicy } from "@repo/agent-runtime/runtime/permissions";
import { ToolOrchestrator, type SandboxViolation } from "@repo/agent-runtime/runtime/tool-orchestrator";
import { DIRECT_TOOL_CALL } from "@repo/agent-runtime/tools/code-mode";
import { deferAgentToolLoading, manifestsToTools } from "@repo/agent-runtime/tools/manifest";
import { createPortableToolRegistry } from "@repo/agent-runtime/tools/registry";
import type { WebSearchInput, WebSearchOutput } from "@repo/agent-runtime/tools/web";
import { isToolUIPart, readUIMessageStream, toUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";

import type {
  DesktopEvent,
  LocalApprovalPolicy,
  LocalPendingInput,
  LocalPermissionProfileId,
  LocalPluginActivation,
  LocalThread,
} from "../../contracts/bridge.generated";
import type { InferenceConfig, ReasoningEffort } from "../../contracts/inference.generated";
import { LocalSandbox, type SandboxOptions } from "../sandbox";
import { LocalJournal } from "./journal";
import { relayModel, type RelayCall } from "./relay-model";

function localWorkspacePath(root: string, value: string): string {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const path = relative(root, absolute);
  if (!path || path === ".." || path.startsWith("../") || isAbsolute(path)) {
    throw new Error("发布文件必须位于授权工作目录内");
  }
  return path;
}

function networkViolationHint(command: string): SandboxViolation | undefined {
  const canonical = canonicalizeShellCommand(command);
  if (!canonical.analyzable) return undefined;
  for (const token of canonical.commands.flat()) {
    try {
      const url = new URL(token);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      return {
        type: "network",
        host: url.hostname,
        port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        protocol: url.protocol === "https:" ? "https" : "http",
      };
    } catch {
      // Non-URL argv tokens do not describe a network authority.
    }
  }
  return undefined;
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

export interface DesktopSessionOptions {
  directory: string;
  controlDirectories: string[];
  supervisor: string;
  executable: string;
  fileWorker: string;
  config(providerId: string, reasoningEffort: ReasoningEffort, signal: AbortSignal): Promise<InferenceConfig>;
  resolvePlugins(activations: readonly PluginActivation[], signal: AbortSignal): Promise<ResolvedTurnPluginSnapshot>;
  webSearch(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchOutput>;
  call: RelayCall;
  emit(event: DesktopEvent): void;
  pluginLoader?: {
    load(snapshot: ResolvedTurnPluginSnapshot, context: AgentPluginContext): Promise<ResolvedPluginSet>;
  };
}
interface Workspace {
  sandbox: LocalSandbox;
  scratch: string;
  watcher: FSWatcher;
  changed: Map<string, number>;
  pendingChanges: Set<string>;
  changeTimer: ReturnType<typeof setTimeout> | null;
  flushChanges(): void;
  queue: Promise<unknown>;
  epoch: number;
}
interface ActiveRun {
  abort: AbortController;
  done: Promise<void>;
  inputChannel: RuntimeInputQueue;
  settlements: Set<Promise<void>>;
  turnId: string;
}

export class DesktopSessionManager {
  readonly journal: LocalJournal;
  private readonly plugins: NonNullable<DesktopSessionOptions["pluginLoader"]>;
  private workspaces = new Map<string, Promise<Workspace>>();
  private active = new Map<string, ActiveRun>();
  private closed = false;
  private segments = new Map<string, { id: string; messages: UIMessage[]; chunks: UIMessageChunk[]; done: boolean }>();
  private current = new Map<string, LocalThread>();
  private observedWorkspaceEpochs = new Map<string, number>();
  private orchestrators = new Map<string, ToolOrchestrator>();
  constructor(private readonly options: DesktopSessionOptions) {
    this.journal = new LocalJournal(options.directory);
    this.plugins = options.pluginLoader ?? new PluginManager();
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
  async create(
    workspace: string,
    providerId: string,
    reasoningEffort: ReasoningEffort,
    approvalPolicy: LocalApprovalPolicy,
    permissionProfile: LocalPermissionProfileId,
    pluginActivations: LocalPluginActivation[],
  ) {
    if (this.closed) throw new Error("本地运行时正在关闭");
    const thread: LocalThread = {
      id: randomUUID(),
      mode: "local",
      title: "本地会话",
      workspace: await realpath(workspace),
      providerId,
      reasoningEffort,
      approvalPolicy,
      permissionProfile,
      pluginActivations: structuredClone(pluginActivations),
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
          pendingChanges: new Set(),
          changeTimer: null,
          flushChanges: () => {},
          queue: Promise.resolve(),
          epoch: 0,
        };
        const flushChanges = () => {
          if (state.changeTimer) clearTimeout(state.changeTimer);
          state.changeTimer = null;
          const paths = [...state.pendingChanges].sort();
          state.pendingChanges.clear();
          if (paths.length === 0) return;
          state.epoch++;
          if (state.changed.size + paths.length <= 1000) {
            for (const path of paths) state.changed.set(path, state.epoch);
          } else {
            state.changed.clear();
            state.changed.set(".", state.epoch);
          }
          for (const item of this.journal.list())
            if (item.workspace === thread.workspace) this.options.emit({ type: "files", threadId: item.id, paths });
        };
        state.flushChanges = flushChanges;
        const scheduleChange = (path: string) => {
          state.pendingChanges.add(path);
          if (state.changeTimer) clearTimeout(state.changeTimer);
          state.changeTimer = setTimeout(flushChanges, 50);
        };
        state.watcher = watch(thread.workspace, { recursive: true }, (_event, filename) => {
          scheduleChange(filename?.toString() ?? ".");
        });
        state.watcher.on("error", () => scheduleChange("."));
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
    const profile = compilePermissionProfile(thread.permissionProfile, { workspaceRoot: thread.workspace }).profile;
    return this.access(thread, (workspace) => workspace.sandbox.file(profile, operation));
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
  submitRunInput(id: string, expectedTurnId: string, text: string, messageId: string, mode: LocalPendingInput["mode"]) {
    if (this.closed) throw new Error("本地运行时正在关闭");
    const thread = this.get(id);
    const existing = thread.pendingInputs.find((input) => input.id === messageId);
    if (existing) {
      if (existing.turnId !== expectedTurnId || existing.text !== text || existing.mode !== mode) {
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
      mode,
      state: "accepted",
    };
    thread.pendingInputs.push(pending);
    this.save(thread);
    const outcome = active.inputChannel
      .submit(text, { id: messageId, mode })
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
  setExecutionPolicy(id: string, approvalPolicy: LocalApprovalPolicy, permissionProfile: LocalPermissionProfileId) {
    const thread = this.get(id);
    if (this.active.has(id) || thread.status === "waiting") {
      throw new Error("当前轮次的权限与审批策略已冻结");
    }
    thread.approvalPolicy = approvalPolicy;
    thread.permissionProfile = permissionProfile;
    this.save(thread);
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
    const runtimeTurn = createRuntimeTurn();
    const inputChannel = runtimeTurn.input;
    const turnId = thread.turnId;
    if (!turnId) throw new Error("本地轮次缺少标识");
    const settlements = new Set<Promise<void>>();
    const done = Promise.resolve().then(() => this.run(thread, abort.signal, runtimeTurn, settlements));
    this.active.set(thread.id, { abort, done, inputChannel, settlements, turnId });
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
    runtimeTurn: RuntimeTurn,
    settlements: Set<Promise<void>>,
  ) {
    let workspace: Workspace | undefined;
    let pluginSet: ResolvedPluginSet | undefined;
    try {
      workspace = await this.workspace(thread);
      const runWorkspace = workspace;
      const turnId = thread.turnId;
      if (!turnId) throw new Error("本地轮次缺少标识");
      const pluginSnapshot = await this.options.resolvePlugins(thread.pluginActivations, signal);
      this.journal.savePluginSnapshot(turnId, pluginSnapshot);
      const pluginContext: AgentPluginContext = {
        turnId,
        threadId: thread.id,
        userId: "desktop-host",
        tenantId: pluginSnapshot.tenantId,
        workspaceId: pluginSnapshot.workspaceId,
        workspaceRole: "",
        signal,
      };
      pluginSet = await this.plugins.load(pluginSnapshot, pluginContext);
      if (pluginSet.skills.length > 0) {
        throw new Error("本地执行尚未配置插件 Skill asset loader");
      }
      const config = await this.options.config(thread.providerId, thread.reasoningEffort, signal);
      const model = relayModel(config, this.options.call);
      let modelEpoch = runWorkspace.epoch;
      const artifacts = publishedArtifacts(thread.messages);
      const portableTools = createPortableToolRegistry({
        model: {
          name: config.model,
          model,
          maxOutputTokens: config.maxOutputTokens,
          supportsStoredContinuation: false,
        },
        webSearch: (input, options) => this.options.webSearch(input, options.abortSignal),
        // Local transport does not yet accept SDK client-tool results. This is
        // a host protocol gap, not a separately curated portable default set.
        clientInteraction: false,
      });
      const activePermission = compilePermissionProfile(thread.permissionProfile, { workspaceRoot: thread.workspace });
      const orchestrator =
        this.orchestrators.get(turnId) ??
        new ToolOrchestrator({
          approvalPolicy: thread.approvalPolicy as ApprovalPolicy,
          permissionProfile: activePermission.profile,
          fileSystemPolicy: {
            workspaceRoot: thread.workspace,
            workingDirectory: thread.workspace,
            immutableWriteRoots: this.options.controlDirectories,
          },
          execPolicy: new ExecPolicy(),
          processManager: runWorkspace.sandbox.processes,
        });
      this.orchestrators.set(turnId, orchestrator);
      const environment = {
        location: "local",
        workspace: {
          root: thread.workspace,
          access: "read-write",
          isolation: "direct",
          persistence: "host",
          externalSources: "unavailable",
        },
        network: {
          access: activePermission.profile.type === "disabled" ? "public" : "restricted",
          protocols: ["http", "https"],
        },
        process: { shell: true, lifetime: "command", backgroundServices: "unsupported" },
        deliverables: "workspace-reference",
        permissions: {
          profileId: activePermission.id,
          enforcement: activePermission.profile.type,
          approvalPolicy: thread.approvalPolicy,
        },
      } as const satisfies ExecutionEnvironment;
      const executionManifests = createExecutionHostManifests({
        environment,
        orchestrator,
        files: {
          readText: async ({ path }, authority, options) => {
            const signal = options.abortSignal
              ? AbortSignal.any([options.abortSignal, authority.abortSignal])
              : authority.abortSignal;
            const result = await this.access(thread, (current) => {
              if (current.epoch !== modelEpoch) {
                throw new Error("工作区在推理后发生变化，请重新读取相关输入再执行");
              }
              return current.sandbox.file(authority.permissionProfile, { operation: "readOptional", path }, signal);
            });
            if (result === null) return null;
            if (
              !result ||
              typeof result !== "object" ||
              !("content" in result) ||
              typeof result.content !== "string" ||
              !("hash" in result) ||
              typeof result.hash !== "string" ||
              !/^[a-f0-9]{64}$/u.test(result.hash)
            ) {
              throw new Error("文件 helper 返回了无效读取结果");
            }
            return { content: result.content, sha256: result.hash, bytes: Buffer.byteLength(result.content) };
          },
          writeText: async ({ path, content, mode, expectedSha256 }, authority, options) => {
            const signal = options.abortSignal
              ? AbortSignal.any([options.abortSignal, authority.abortSignal])
              : authority.abortSignal;
            const result = await this.access(thread, async (current) => {
              if (current.epoch !== modelEpoch) {
                throw new Error("工作区在推理后发生变化，请重新读取相关输入再执行");
              }
              const written = await current.sandbox.file(
                authority.permissionProfile,
                {
                  operation: "write",
                  path,
                  content,
                  expectedHash: mode === "create" ? null : expectedSha256,
                },
                signal,
              );
              await new Promise<void>((resolve) => {
                setImmediate(resolve);
              });
              current.flushChanges();
              return written;
            });
            if (
              !result ||
              typeof result !== "object" ||
              !("hash" in result) ||
              typeof result.hash !== "string" ||
              !/^[a-f0-9]{64}$/u.test(result.hash)
            ) {
              throw new Error("文件 helper 返回了无效写入结果");
            }
            return {
              path,
              sha256: result.hash,
              bytes: Buffer.byteLength(content),
              created: mode === "create",
            };
          },
          deleteFile: async ({ path, expectedSha256 }, authority, options) => {
            const signal = options.abortSignal
              ? AbortSignal.any([options.abortSignal, authority.abortSignal])
              : authority.abortSignal;
            await this.access(thread, async (current) => {
              if (current.epoch !== modelEpoch) {
                throw new Error("工作区在推理后发生变化，请重新读取相关输入再执行");
              }
              await current.sandbox.file(
                authority.permissionProfile,
                { operation: "delete", path, expectedHash: expectedSha256 },
                signal,
              );
              await new Promise<void>((resolve) => {
                setImmediate(resolve);
              });
              current.flushChanges();
            });
          },
        },
        deliver: async (candidate, options) => {
          const path = localWorkspacePath(thread.workspace, candidate);
          const inspection = await this.access(thread, (current) =>
            current.sandbox.file(activePermission.profile, { operation: "inspect", path }, options.abortSignal),
          );
          if (
            !inspection ||
            typeof inspection !== "object" ||
            !("size" in inspection) ||
            !Number.isSafeInteger(inspection.size) ||
            !("etag" in inspection) ||
            typeof inspection.etag !== "string" ||
            !/^"[a-f0-9]{32}"$/.test(inspection.etag)
          ) {
            throw new Error("无法检查待交付文件");
          }
          const fileId = createHash("sha256").update(`${thread.id}\0${path}`).digest("hex").slice(0, 32);
          const previous = artifacts.get(fileId);
          const data: PublishedWorkspaceFile = {
            file_id: fileId,
            filename: previous?.filename ?? basename(path),
            title: previous?.title ?? basename(path),
            media_type: previous?.media_type ?? workspaceMediaType(path),
            kind: previous?.kind ?? (path.toLowerCase().endsWith("-plan.md") ? "plan" : "artifact"),
            etag: inspection.etag,
            updated: Boolean(previous),
            workspace_path: path,
          };
          artifacts.set(fileId, data);
          return data;
        },
        run: (input, attempt, options) =>
          this.access(thread, async (w) => {
            if (w.epoch !== modelEpoch) throw new Error("工作区在推理后发生变化，请重新读取相关输入再执行");
            const result = await w.sandbox.execute(
              attempt,
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
              input.timeout_ms,
              networkViolationHint(input.command),
            );
            await new Promise<void>((resolve) => {
              setImmediate(resolve);
            });
            w.flushChanges();
            return result;
          }),
      });
      const pluginManifests = pluginSet.manifests.map((manifest) => {
        if (manifest.policy.source !== "mcp") {
          throw new Error(`agent plugin ${manifest.policy.pluginId ?? "unknown"} contributed a non-MCP tool`);
        }
        return deferAgentToolLoading(manifest);
      });
      const manifests = [...portableTools.manifests, ...executionManifests, ...pluginManifests];
      const tools = manifestsToTools(manifests);
      const activeTools = Object.keys(tools);
      const codeModeToolCallers = Object.fromEntries(
        manifests
          .filter((manifest) => manifest.policy.callableByCodeMode)
          .map((manifest) => [manifest.name, ["code_mode", DIRECT_TOOL_CALL] as const]),
      );
      const original = structuredClone(thread.messages);
      const projected = await projectRuntimeContext({
        messages: original,
        model,
        limits: config,
        checkpoint: this.journal.getCheckpoint(thread.id),
        signal,
        saveCheckpoint: async (checkpoint) => this.journal.saveCheckpoint(thread.id, checkpoint),
      });
      const started = await runtimeTurn.start({
        messages: projected.messages,
        signal,
        prepare: async () => ({
          settings: {
            model,
            tools,
            toolApproval: orchestrator.toolApproval,
            activeTools,
            toolOrder: [...activeTools].sort(),
            experimental_toolCallers: codeModeToolCallers as never,
            maxOutputTokens: config.maxOutputTokens,
            instructions: attachExecutionEnvironment(config.instructions, environment),
            prepareStep: ({ messages }) => {
              workspace!.flushChanges();
              modelEpoch = workspace!.epoch;
              const observed = this.observedWorkspaceEpochs.get(thread.id) ?? 0;
              const changes = [...workspace!.changed].filter(([, epoch]) => epoch > observed).map(([path]) => path);
              this.observedWorkspaceEpochs.set(thread.id, modelEpoch);
              return changes.length > 0 ? { messages: appendWorkspaceChangeEvent(messages, changes) } : {};
            },
          },
          host: null,
        }),
      });
      const result = started.result;
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
          transform: (incoming, controller) => {
            for (const chunk of [incoming, ...fileDataChunks(incoming)]) {
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
            }
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
      await runtimeTurn.dispose();
      await pluginSet?.dispose();
      workspace?.sandbox.cancel();
      if (workspace) await workspace.queue;
      await Promise.allSettled([...settlements]);
      if (thread.status !== "waiting" && thread.turnId) {
        this.orchestrators.get(thread.turnId)?.close();
        this.orchestrators.delete(thread.turnId);
      }
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
      if (thread.turnId) {
        this.orchestrators.get(thread.turnId)?.close();
        this.orchestrators.delete(thread.turnId);
      }
    }
  }
  async remove(id: string) {
    await this.stop(id);
    this.segments.delete(id);
    this.observedWorkspaceEpochs.delete(id);
    const turnId = this.get(id).turnId;
    if (turnId) {
      this.orchestrators.get(turnId)?.close();
      this.orchestrators.delete(turnId);
    }
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
    if (workspace.changeTimer) clearTimeout(workspace.changeTimer);
    workspace.watcher.close();
    await rm(workspace.scratch, { recursive: true, force: true });
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.active.keys()].map((id) => this.stop(id)));
    await Promise.all([...this.workspaces.keys()].map((id) => this.release(id)));
    for (const orchestrator of this.orchestrators.values()) orchestrator.close();
    this.orchestrators.clear();
    this.journal.close();
  }
}
