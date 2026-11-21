import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { realpath, rm } from "node:fs/promises";

import type { LanguageModelV4Middleware } from "@ai-sdk/provider";
import {
  RuntimeTurn,
  type TurnScope,
  contextCompactionThreshold,
  appendWorkspaceChangeEvent,
  attachExecutionEnvironment,
  renderAvailableSkills,
  projectRuntimeContext,
  estimateSessionContext,
  finalizeSessionContext,
  type ContextEstimate,
  PluginManager,
  type AgentPluginContext,
  type PluginActivation,
  type ResolvedPluginSet,
  type ResolvedTurnPluginSnapshot,
  applyToolApprovalResponse,
  finalizeInterruptedMessages,
  hasPendingToolApprovals,
  type RuntimeTurnSettings,
  SessionServices,
  fileDataChunks,
  continuedSkillName,
  type WebSearchInput,
  type WebSearchOutput,
  ToolOrchestrator,
  createPortableToolRegistry,
  compileTurnTools,
  ExecPolicy,
  compilePermissionProfile,
  runtimeTokenUsage,
} from "@repo/agent-runtime";
import { consumeStream, createUIMessageStream, toUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";

import type {
  DesktopEvent,
  LocalApprovalPolicy,
  LocalPendingInput,
  LocalPermissionProfileId,
  LocalPluginActivation,
  LocalThread,
  LocalUserMessagePart,
} from "../../contracts/bridge.generated";
import type { InferenceConfig, ReasoningEffort } from "../../contracts/inference.generated";
import { localUserMessagePreview } from "../local-user-message";
import { attachmentDirectory, selectedWorkspacePath, storeAttachment } from "./attachments";
import { localExecutionTools } from "./execution-tools";
import { LocalJournal } from "./journal";
import { resolveDesktopPlugins } from "./local-plugins";
import { isRetryableModelConnectionError, relayModel, type RelayCall } from "./relay-model";
import { LocalWorkspaces } from "./workspace";

const MODEL_STREAM_RETRIES = 3;

function waitForModelRetry(attempt: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const base = 200 * 2 ** (attempt - 1);
  const delay = Math.round(base * (0.9 + Math.random() * 0.2));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
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
  waitForModelRetry?(attempt: number, signal: AbortSignal): Promise<void>;
  pluginLoader?: {
    load(snapshot: ResolvedTurnPluginSnapshot, context: AgentPluginContext): Promise<ResolvedPluginSet>;
  };
}
interface ActiveRun {
  turn: RuntimeTurn;
  done: Promise<void>;
  settlements: Set<Promise<void>>;
  turnId: string;
}

function failureMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export class DesktopSessionManager {
  readonly journal: LocalJournal;
  private readonly plugins: NonNullable<DesktopSessionOptions["pluginLoader"]>;
  private readonly workspaces: LocalWorkspaces;
  private readonly sessions = new Map<string, { policy: string; services: SessionServices }>();
  private active = new Map<string, ActiveRun>();
  private closed = false;
  private segments = new Map<string, { id: string; messages: UIMessage[]; chunks: UIMessageChunk[]; done: boolean }>();
  private current = new Map<string, LocalThread>();
  private observedWorkspaceEpochs = new Map<string, number>();
  constructor(private readonly options: DesktopSessionOptions) {
    this.journal = new LocalJournal(options.directory);
    this.options = {
      ...options,
      directory: realpathSync(options.directory),
      controlDirectories: options.controlDirectories.map((path) => realpathSync(path)),
    };
    this.workspaces = new LocalWorkspaces(
      {
        supervisor: options.supervisor,
        executable: options.executable,
        fileWorker: options.fileWorker,
        protectedPaths: this.options.controlDirectories,
      },
      (root, paths) => {
        for (const thread of this.journal.list()) {
          if (thread.workspace === root) options.emit({ type: "files", threadId: thread.id, paths });
        }
      },
    );
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
  private emitStreamChunk(threadId: string, chunk: UIMessageChunk) {
    const segment = this.segments.get(threadId);
    if (!segment || segment.done) return;
    segment.chunks.push(chunk);
    this.options.emit({
      type: "stream",
      threadId,
      segmentId: segment.id,
      index: segment.chunks.length - 1,
      chunk,
    });
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
      contextUsage: null,
      messages: [],
    };
    await this.workspaces.open(thread.workspace);
    this.save(thread);
    return thread;
  }
  async file(id: string, operation: Record<string, unknown>) {
    const thread = this.get(id);
    const profile = compilePermissionProfile(thread.permissionProfile, { workspaceRoot: thread.workspace }).profile;
    return this.workspaces.access(thread.workspace, (workspace) =>
      workspace.sandbox.file(profile, operation, undefined, attachmentDirectory(this.options.directory, thread.id)),
    );
  }
  workspaceFilePath(id: string, path: string) {
    return selectedWorkspacePath(this.get(id).workspace, path, this.options.controlDirectories);
  }
  async importAttachment(id: string, filename: string, bytes: Uint8Array) {
    const { workspace } = this.get(id);
    return this.workspaces.access(workspace, async () => {
      this.get(id);
      const root = attachmentDirectory(this.options.directory, id);
      return storeAttachment(root, filename, bytes);
    });
  }
  openStream(id: string) {
    return { thread: this.get(id), segment: this.segments.get(id) ?? null };
  }
  send(id: string, parts: LocalUserMessagePart[], messageId: string) {
    if (this.active.has(id)) throw new Error("当前会话仍在执行");
    if (this.closed) throw new Error("本地运行时正在关闭");
    for (const activeId of this.active.keys())
      if (this.get(activeId).workspace === this.get(id).workspace) throw new Error("同一个工作目录已有会话正在执行");
    const thread = this.get(id);
    if (thread.status === "waiting") throw new Error("请先处理待审批的命令，或停止当前轮次");
    thread.turnId = randomUUID();
    thread.error = null;
    if (thread.messages.length === 0) thread.title = localUserMessagePreview(parts).slice(0, 80);
    thread.messages.push({ id: messageId, role: "user", parts: structuredClone(parts) });
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
    const outcome = active.turn.input
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
  async setExecutionPolicy(
    id: string,
    approvalPolicy: LocalApprovalPolicy,
    permissionProfile: LocalPermissionProfileId,
  ) {
    const thread = this.get(id);
    if (this.active.has(id) || thread.status === "waiting") {
      throw new Error("当前轮次的权限与审批策略已冻结");
    }
    if (thread.approvalPolicy === approvalPolicy && thread.permissionProfile === permissionProfile) return;
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    const drained = session?.services.close();
    thread.approvalPolicy = approvalPolicy;
    thread.permissionProfile = permissionProfile;
    this.save(thread);
    await drained;
  }
  setModelBinding(id: string, providerId: string, reasoningEffort: ReasoningEffort) {
    const thread = this.get(id);
    if (this.active.has(id) || thread.status === "waiting") {
      throw new Error("当前轮次的模型与推理深度已冻结");
    }
    thread.providerId = providerId;
    thread.reasoningEffort = reasoningEffort;
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
    const turn = new RuntimeTurn();
    const turnId = thread.turnId;
    if (!turnId) throw new Error("本地轮次缺少标识");
    const settlements = new Set<Promise<void>>();
    const done = Promise.resolve().then(() => this.run(thread, turn, settlements));
    this.active.set(thread.id, { turn, done, settlements, turnId });
    void done
      .finally(() => {
        this.active.delete(thread.id);
        this.current.delete(thread.id);
      })
      .catch(() => undefined);
  }
  private async prepare(thread: LocalThread, scope: TurnScope) {
    const signal = scope.signal;
    const runWorkspace = await this.workspaces.open(thread.workspace);
    scope.defer(async () => {
      await runWorkspace.queue;
    });
    signal.throwIfAborted();
    const turnId = thread.turnId;
    if (!turnId) throw new Error("本地轮次缺少标识");
    const { snapshot: pluginSnapshot, bodies } = await resolveDesktopPlugins(
      this.options.directory,
      this.journal.getPluginSnapshot(turnId),
      thread.pluginActivations,
      (selection, abort) => this.options.resolvePlugins(selection, abort),
      signal,
    );
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
    const pluginSet = await this.plugins.load(pluginSnapshot, pluginContext);
    scope.defer(() => pluginSet.dispose());
    if (pluginSet.skills.some((skill) => !bodies.has(`${skill.pluginId}:${skill.name}`))) {
      throw new Error("本地执行尚未配置插件 Skill asset loader");
    }
    const config = await this.options.config(thread.providerId, thread.reasoningEffort, signal);
    const model = relayModel(config, this.options.call);
    let modelRetryAttempt = 0,
      modelRetryActive = false;
    const emitModelRetry = (state: "retrying" | "recovered" | "failed") => {
      this.emitStreamChunk(thread.id, {
        type: "data-model-retry",
        data: { state, attempt: modelRetryAttempt, maxAttempts: MODEL_STREAM_RETRIES },
        transient: true,
      });
    };
    let modelEpoch = runWorkspace.epoch;
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
      skillSource: { skills: [...bodies.values()], activeSkillName: continuedSkillName(thread.messages.at(-1)) },
    });
    const activePermission = compilePermissionProfile(thread.permissionProfile, { workspaceRoot: thread.workspace });
    const policy = JSON.stringify([activePermission.profile, thread.approvalPolicy]);
    let session = this.sessions.get(thread.id);
    if (session?.policy !== policy) {
      await session?.services.close();
      session = { policy, services: new SessionServices() };
      this.sessions.set(thread.id, session);
    }
    const attachmentRoot = attachmentDirectory(this.options.directory, thread.id);
    const orchestrator = new ToolOrchestrator({
      continuation: thread.messages.at(-1),
      approvalPolicy: thread.approvalPolicy,
      permissionProfile: activePermission.profile,
      fileSystemPolicy: {
        workspaceRoot: thread.workspace,
        workingDirectory: thread.workspace,
        immutableWriteRoots: this.options.controlDirectories,
        additionalReadRoots: [attachmentRoot],
      },
      execPolicy: new ExecPolicy(),
      sessionServices: session.services,
    });
    scope.defer(() => orchestrator.close());
    const { environment, executionManifests } = localExecutionTools(
      thread,
      this.workspaces,
      activePermission,
      orchestrator,
      () => modelEpoch,
      attachmentRoot,
    );
    const { tools, activeTools, toolCallers, toolSources } = compileTurnTools(
      [...portableTools.manifests, ...executionManifests],
      pluginSet.manifests,
    );
    let contextEstimate: ContextEstimate | undefined;
    const contextCaptureMiddleware: LanguageModelV4Middleware = {
      specificationVersion: "v4",
      transformParams: async ({ params }) => {
        contextEstimate = estimateSessionContext({ prompt: params.prompt, tools: params.tools, toolSources });
        return params;
      },
    };
    const original = structuredClone(thread.messages);
    const projected = await projectRuntimeContext({
      messages: original,
      tools,
      model,
      limits: config,
      checkpoint: this.journal.getCheckpoint(thread.id),
      signal,
      saveCheckpoint: async (checkpoint) => this.journal.saveCheckpoint(thread.id, checkpoint),
    });
    const assistantId = original.at(-1)?.role === "assistant" ? original.at(-1)!.id : randomUUID();
    return {
      messages: projected.messages,
      settings: {
        model,
        contextLimits: config,
        stepCheckpoint: { assistantId, save: projected.saveStepCheckpoint },
        middleware: [contextCaptureMiddleware],
        tools,
        toolApproval: orchestrator.toolApproval,
        activeTools,
        experimental_toolCallers: toolCallers as never,
        maxOutputTokens: config.maxOutputTokens,
        maxRetries: 0,
        streamRetries: MODEL_STREAM_RETRIES,
        instructions: attachExecutionEnvironment(
          [config.instructions, renderAvailableSkills(portableTools.skills)].filter(Boolean).join("\n\n"),
          environment,
        ),
        onStepEnd: (event) => {
          const usage = runtimeTokenUsage(event.usage);
          const snapshot = finalizeSessionContext(contextEstimate, usage);
          contextEstimate = undefined;
          if (!snapshot) return;
          thread.contextUsage = {
            contextWindow: config.contextWindow,
            autoCompactAt: contextCompactionThreshold(config),
            usedTokens: snapshot.usedTokens,
            estimated: !(usage.inputTokens != null && usage.inputTokens > 0),
            compacted: this.journal.getCheckpoint(thread.id) !== null,
            categories: snapshot.categories.map((category) => ({
              id: category.id === "session" ? "conversation" : category.id,
              tokens: category.tokens,
            })),
          };
          this.save(thread);
        },
        onStepStart: () => {
          modelRetryAttempt = 0;
          modelRetryActive = false;
        },
        onChunk: ({ chunk }) => {
          if (
            modelRetryActive &&
            chunk.type !== "error" &&
            chunk.type !== "ping" &&
            chunk.type !== "start" &&
            chunk.type !== "start-step"
          ) {
            modelRetryActive = false;
            emitModelRetry("recovered");
          }
        },
        onError: async ({ error }) => {
          if (!isRetryableModelConnectionError(error)) return;
          if (modelRetryAttempt >= MODEL_STREAM_RETRIES) {
            modelRetryActive = false;
            emitModelRetry("failed");
            return;
          }
          modelRetryAttempt++;
          modelRetryActive = true;
          emitModelRetry("retrying");
          await (this.options.waitForModelRetry ?? waitForModelRetry)(modelRetryAttempt, signal);
        },
        prepareStep: ({ messages }) => {
          runWorkspace.flushChanges();
          modelEpoch = runWorkspace.epoch;
          const observed = this.observedWorkspaceEpochs.get(thread.id) ?? 0;
          const changes = [...runWorkspace.changed].filter(([, epoch]) => epoch > observed).map(([path]) => path);
          this.observedWorkspaceEpochs.set(thread.id, modelEpoch);
          return changes.length > 0 ? { messages: appendWorkspaceChangeEvent(messages, changes) } : {};
        },
      } satisfies RuntimeTurnSettings<Record<string, unknown>>,
      host: { original, assistantId },
    };
  }
  private async run(thread: LocalThread, turn: RuntimeTurn, settlements: Set<Promise<void>>) {
    let persistenceError: Error | undefined;
    try {
      const {
        result,
        tools,
        host: { original, assistantId },
      } = await turn.start((scope) => this.prepare(thread, scope));
      const stream = toUIMessageStream({
        stream: result.stream,
        tools,
        originalMessages: original,
        generateMessageId: () => assistantId,
        onError: (error) => failureMessage(error, "本地执行失败"),
      });
      let bytes = 0;
      const observed = stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform: (incoming, controller) => {
            for (const chunk of [incoming, ...fileDataChunks(incoming)]) {
              bytes += Buffer.byteLength(JSON.stringify(chunk));
              if (bytes > 16 * 1024 * 1024) throw new Error("当前轮次输出过大，请分步执行");
              this.emitStreamChunk(thread.id, chunk);
              controller.enqueue(chunk);
            }
          },
        }),
      );
      const record = (message: UIMessage) => {
        const index = thread.messages.findIndex((item) => item.id === message.id);
        if (index < 0) thread.messages.push(message);
        else thread.messages[index] = message;
      };

      const journalStream = createUIMessageStream({
        originalMessages: original,
        generateId: () => assistantId,
        execute: ({ writer }) => writer.merge(observed),
        onStepEnd: ({ responseMessage }) => {
          record(responseMessage);
          try {
            this.save(thread);
          } catch (error) {
            persistenceError = error instanceof Error ? error : new Error(String(error));
            turn.cancel();
            throw persistenceError;
          }
        },
        onEnd: ({ responseMessage }) => {
          if (responseMessage.parts.length) record(responseMessage);
        },
        onError: (error) => {
          const failure = error instanceof Error ? error : new Error(String(error));
          if (!turn.cancelled) persistenceError ??= failure;
          return failure.message;
        },
      });
      await consumeStream({
        stream: journalStream,
        onError: (error) => {
          throw error;
        },
      });
      if (persistenceError) throw persistenceError;
      turn.signal.throwIfAborted();
      thread.status = hasPendingToolApprovals(thread.messages) ? "waiting" : "idle";
    } catch (error) {
      thread.status = turn.cancelled && !persistenceError ? "cancelled" : "error";
      thread.error =
        thread.status === "cancelled" ? "已停止，磁盘上的修改仍保留" : failureMessage(error, "本地运行失败");
      thread.messages = finalizeInterruptedMessages(thread.messages, thread.error);
    } finally {
      try {
        await turn.dispose();
      } catch (error) {
        thread.status = "error";
        thread.error = error instanceof Error ? error.message : "本地运行资源释放失败";
        thread.messages = finalizeInterruptedMessages(thread.messages, thread.error);
      }
      await Promise.allSettled(settlements);
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
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    const drained = session?.services.close();
    const active = this.active.get(id);
    if (active) {
      active.turn.cancel();
      await active.done;
      await drained;
      return;
    }
    await drained;
    const thread = this.get(id);
    if (thread.status === "waiting") {
      thread.status = "cancelled";
      thread.error = "用户停止了待审批轮次";
      thread.messages = finalizeInterruptedMessages(thread.messages, thread.error);
      this.save(thread);
    }
  }
  async remove(id: string) {
    const { workspace } = this.get(id);
    await this.stop(id);
    this.segments.delete(id);
    this.observedWorkspaceEpochs.delete(id);
    this.journal.remove(id);
    await this.workspaces.drain(workspace);
    await rm(attachmentDirectory(this.options.directory, id), { recursive: true, force: true });
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.active.keys()].map((id) => this.stop(id)));
    await Promise.all([...this.sessions.values()].map((session) => session.services.close()));
    this.sessions.clear();
    await this.workspaces.close();
    this.journal.close();
  }
}
