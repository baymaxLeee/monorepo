import { Chat } from "@ai-sdk/react";
import { type ConversationScrollHandle } from "@repo/ai-elements";
import {
  chatDataPartSchemas,
  createMCPAppContext,
  ChatPrompt,
  contextCompactionStatusText,
  ConversationSessionView,
  hasCompletedClientTool,
  PageToolSession,
  modelRetryStatusText,
  type ClientToolExecutor,
  type PreparePageContext,
  type ChatUIDataTypes,
  type ChatUIMessage,
} from "@repo/ai-elements/conversation";
import type { PromptInputRef, PromptInputValue } from "@repo/ai-elements/prompt-input";
import { listProviders, type ModelProvider } from "@repo/api/admin";
import { getLocalInferenceConfig, type GetLocalInferenceConfig200 } from "@repo/api/chat";
import type { DesktopBridge, LocalThread } from "@repo/runtime/desktop";
import { getErrorMessage, randomId } from "@repo/shared";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { selectLocalArtifact, useLocalArtifact } from "../../stores/useLocalArtifact";
import { localSessionState } from "./local-session-state";
import { localPromptMessageParts } from "./local-user-message";
import { LocalComposerEndControls, LocalComposerStartControls } from "./LocalComposerControls";
import type { LocalChatTransport } from "./transport";

export function LocalSession({
  bridge,
  initial,
  transport,
  clientToolExecutor,
  preparePageContext,
}: {
  bridge: DesktopBridge;
  initial: LocalThread;
  transport: LocalChatTransport;
  clientToolExecutor?: ClientToolExecutor;
  preparePageContext?: PreparePageContext;
}) {
  const [error, setError] = useState<string | null>(null);
  const [modelRetry, setModelRetry] = useState<ChatUIDataTypes["model-retry"] | null>(null);
  const [contextCompaction, setContextCompaction] = useState<ChatUIDataTypes["context-compaction"] | null>(null);
  const [inferenceConfig, setInferenceConfig] = useState<GetLocalInferenceConfig200 | null>(null);
  const [models, setModels] = useState<ModelProvider[]>([]);
  const appContext = useMemo(
    () =>
      createMCPAppContext(async (callId, _pluginId, name, args, signal) => {
        signal.throwIfAborted();
        const requestId = randomId();
        const cancel = () => {
          void bridge.cancelAppCall(initial.id, requestId).catch(() => undefined);
        };
        signal.addEventListener("abort", cancel, { once: true });
        try {
          return await bridge.callAppTool(initial.id, requestId, callId, name, args);
        } finally {
          signal.removeEventListener("abort", cancel);
        }
      }),
    [bridge, initial.id],
  );
  const promptRef = useRef<PromptInputRef>(null);
  const pendingPrompt = useRef<PromptInputValue | null>(null);
  const pendingClientContinuation = useRef(false);
  const [page] = useState(() => clientToolExecutor && new PageToolSession(clientToolExecutor));
  const [chat] = useState<Chat<ChatUIMessage>>(
    () =>
      new Chat<ChatUIMessage>({
        id: initial.id,
        messages: initial.messages as ChatUIMessage[],
        transport: page?.transport(transport) ?? transport,
        onToolCall: ({ toolCall }) => {
          void page
            ?.respond(toolCall, (result) => {
              pendingClientContinuation.current = true;
              return chat.addToolOutput(result);
            })
            .catch((cause) => setError(getErrorMessage(cause)));
        },
        generateId: randomId,
        dataPartSchemas: chatDataPartSchemas,
        sendAutomaticallyWhen: (options) => {
          const ready =
            pendingClientContinuation.current &&
            hasCompletedClientTool(options.messages) &&
            lastAssistantMessageIsCompleteWithToolCalls(options);
          if (ready) pendingClientContinuation.current = false;
          return ready;
        },
        onData: (part) => {
          if (part.type === "data-model-retry") {
            setModelRetry(part.data.state === "recovered" ? null : part.data);
            return;
          }
          if (part.type === "data-context-compaction")
            setContextCompaction(part.data.state === "completed" ? null : part.data);
          if (
            part.type === "data-context-usage" &&
            part.data.contextWindow !== null &&
            part.data.autoCompactAt !== null
          ) {
            const contextUsage: NonNullable<LocalThread["contextUsage"]> = {
              ...part.data,
              contextWindow: part.data.contextWindow,
              autoCompactAt: part.data.autoCompactAt,
            };
            setState((current) => ({ ...current, contextUsage }));
          }
        },
        onError: (cause) => {
          const pending = pendingPrompt.current;
          pendingPrompt.current = null;
          if (pending) promptRef.current?.setValue(pending);
          setError(getErrorMessage(cause));
        },
      }),
  );
  const [status, setStatus] = useState(chat.status);
  const [state, setState] = useState(() => localSessionState(initial));
  const approving = useRef(false);
  const scrollRef = useRef<ConversationScrollHandle>(null);

  useEffect(() => {
    const controller = new AbortController();
    void listProviders({ signal: controller.signal, skipErrorNotify: true })
      .then((providers) => {
        if (!controller.signal.aborted) {
          setModels(providers.filter((provider) => provider.provider_kind === "chat" && provider.is_enabled));
        }
      })
      .catch(() => setModels([]));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getLocalInferenceConfig(
      { provider_id: state.providerId, reasoning_effort: state.reasoningEffort },
      { signal: controller.signal, skipErrorNotify: true },
    )
      .then((config) => {
        if (!controller.signal.aborted) setInferenceConfig(config);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [state.providerId, state.reasoningEffort]);

  useEffect(() => {
    const applyThread = (thread: LocalThread) => {
      if (thread.status === "cancelled" || thread.status === "error" || thread.status === "interrupted") page?.stop();
      setState(localSessionState(thread));
      if (thread.status !== "running") {
        setModelRetry(null);
        setContextCompaction(null);
      }
    };
    const off = bridge.subscribe((event) => {
      if (event.type === "runtime-error") setError(event.message);
      if (event.type === "runtime-ready") {
        setError(null);
        void transport
          .load()
          .then(async (thread) => {
            chat.messages = thread.messages as ChatUIMessage[];
            applyThread(thread);
            await chat.resumeStream();
          })
          .catch((cause) => setError(getErrorMessage(cause)));
      }
      if (event.type === "thread" && event.thread.id === initial.id) {
        applyThread(event.thread);
        if (event.thread.status !== "running") chat.messages = event.thread.messages as ChatUIMessage[];
      }
    });
    return () => {
      page?.stop();
      off();
      transport.dispose();
      void chat.stop();
    };
  }, [bridge, chat, initial.id, transport, page]);

  const openWorkspaceFile = useCallback(
    (path: string) => void selectLocalArtifact({ threadId: initial.id, path }),
    [initial.id],
  );
  useEffect(
    () => () => {
      if (useLocalArtifact.getState().selected?.threadId === initial.id) useLocalArtifact.setState({ selected: null });
    },
    [initial.id],
  );

  const approve = useCallback(
    async (id: string, accepted: boolean) => {
      if (approving.current) return;
      approving.current = true;
      setError(null);
      try {
        await bridge.approve(initial.id, id, accepted);
        const thread = await transport.load();
        chat.messages = thread.messages as ChatUIMessage[];
        await chat.resumeStream();
      } catch (cause) {
        setError(getErrorMessage(cause));
      } finally {
        approving.current = false;
      }
    },
    [bridge, chat, initial.id, transport, page],
  );

  const busy = state.status === "running" || status === "streaming" || status === "submitted";
  const updateModelBinding = useCallback(
    async (providerId: string, reasoningEffort: LocalThread["reasoningEffort"]) => {
      setError(null);
      try {
        await bridge.setModelBinding(initial.id, providerId, reasoningEffort);
        setState((current) => ({ ...current, providerId, reasoningEffort }));
      } catch (cause) {
        setError(getErrorMessage(cause));
      }
    },
    [bridge, initial.id],
  );
  const updateExecutionPolicy = useCallback(
    async (approvalPolicy: LocalThread["approvalPolicy"], permissionProfile: LocalThread["permissionProfile"]) => {
      setError(null);
      try {
        await bridge.setExecutionPolicy(initial.id, approvalPolicy, permissionProfile);
        setState((current) => ({ ...current, approvalPolicy, permissionProfile }));
      } catch (cause) {
        setError(getErrorMessage(cause));
      }
    },
    [bridge, initial.id],
  );
  const submit = useCallback(
    async (value: PromptInputValue) => {
      if (state.status === "waiting" || (!value.text.trim() && value.tokens.length === 0)) return;
      setError(null);
      setModelRetry(null);
      setContextCompaction(null);
      chat.clearError();
      if (busy) {
        if (value.tokens.length > 0) {
          setError("当前任务运行中暂不接收新附件");
          return;
        }
        if (!state.turnId) {
          setError("当前轮次缺少标识，请刷新后重试");
          return;
        }
        const messageId = randomId();
        try {
          await bridge.submitRunInput(initial.id, state.turnId, value.text, messageId, "follow-up");
          if (promptRef.current?.getValue().text === value.text) promptRef.current.clear();
        } catch (cause) {
          setError(getErrorMessage(cause));
        }
        return;
      }
      pendingPrompt.current = value;
      promptRef.current?.clear();
      try {
        const parts = await localPromptMessageParts(value, (file) => bridge.referenceFile(initial.id, file));
        const context = appContext.prepare(preparePageContext);
        if (context) parts.push({ type: "text", text: context.text });
        await chat.sendMessage({ parts });
        if (chat.status !== "error") context?.acknowledge();
        pendingPrompt.current = null;
      } catch (cause) {
        const pending = pendingPrompt.current;
        pendingPrompt.current = null;
        if (pending) promptRef.current?.setValue(pending);
        setError(getErrorMessage(cause));
      }
    },
    [appContext, bridge, busy, chat, initial.id, preparePageContext, state.status, state.turnId],
  );

  return (
    <ConversationSessionView
      promptRef={promptRef}
      appContext={appContext}
      title={state.title}
      chat={chat}
      resume
      scrollRef={scrollRef}
      onStatusChange={setStatus}
      runActive={state.status === "running"}
      conversationId={initial.id}
      loading={false}
      branches={[]}
      onOpenWorkspaceFile={openWorkspaceFile}
      pendingInputs={state.pendingInputs.flatMap((input) =>
        input.state === "accepted" || input.state === "not_delivered" || input.state === "unconfirmed"
          ? [{ id: input.id, text: input.text, mode: input.mode, state: input.state }]
          : [],
      )}
      onToolApproval={(id, accepted) => void approve(id, accepted)}
      issue={
        error || state.error ? (
          <p role="alert" className="mx-auto w-full max-w-4xl px-4 text-sm text-destructive">
            {error ?? state.error}
          </p>
        ) : modelRetry ? (
          <p
            role={modelRetry.state === "retrying" ? "status" : "alert"}
            className="mx-auto w-full max-w-4xl px-4 text-sm text-muted-foreground"
          >
            {modelRetryStatusText(modelRetry)}
          </p>
        ) : contextCompaction ? (
          <p role="status" className="mx-auto w-full max-w-4xl px-4 text-sm text-muted-foreground">
            {contextCompactionStatusText(contextCompaction)}
          </p>
        ) : null
      }
      composer={(activePlan) => (
        <ChatPrompt
          ref={promptRef}
          activePlan={activePlan}
          placeholder={state.status === "waiting" ? "等待工具响应…" : busy ? "补充当前任务…" : "发送消息或创建任务…"}
          loading={busy || state.status === "waiting"}
          submitWhileLoading={busy && state.status !== "waiting"}
          maxFiles={busy || state.status === "waiting" ? 0 : 8}
          maxFileSize={10 * 1024 * 1024}
          onError={setError}
          onStop={() => {
            page?.stop();
            void bridge.stop(initial.id).catch((cause) => setError(getErrorMessage(cause)));
          }}
          onSubmit={(value) => void submit(value)}
          footerStartRender={() => (
            <LocalComposerStartControls
              state={state}
              busy={busy}
              onExecutionPolicyChange={(approvalPolicy, permissionProfile) =>
                void updateExecutionPolicy(approvalPolicy, permissionProfile)
              }
            />
          )}
          footerEndRender={() => (
            <LocalComposerEndControls
              models={models}
              fallbackModel={{
                id: state.providerId,
                name: inferenceConfig?.providerName ?? inferenceConfig?.model ?? "推理模型",
              }}
              state={state}
              busy={busy}
              onModelChange={(providerId) => void updateModelBinding(providerId, state.reasoningEffort)}
              onReasoningChange={(reasoningEffort) => void updateModelBinding(state.providerId, reasoningEffort)}
            />
          )}
        />
      )}
    />
  );
}
