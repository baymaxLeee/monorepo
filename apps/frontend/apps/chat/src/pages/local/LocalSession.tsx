import { Chat } from "@ai-sdk/react";
import { ContextUsage, type ConversationScrollHandle } from "@repo/ai-elements";
import {
  ChatComposerControls,
  ChatPrompt,
  ConversationSessionView,
  type ChatUIMessage,
} from "@repo/ai-elements/conversation";
import type { PromptInputRef, PromptInputValue } from "@repo/ai-elements/prompt-input";
import { listProviders, type ModelProvider } from "@repo/api/admin";
import { getLocalInferenceConfig, type GetLocalInferenceConfig200 } from "@repo/api/chat";
import { Button } from "@repo/design-system";
import type { DesktopBridge, LocalThread } from "@repo/runtime/desktop";
import { randomId, getErrorMessage } from "@repo/shared";
import { PlusIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LocalChatTransport } from "./transport";

export function LocalSession({
  bridge,
  initial,
  transport,
  onOpenFiles,
  onOpenFile,
}: {
  bridge: DesktopBridge;
  initial: LocalThread;
  transport: LocalChatTransport;
  onOpenFiles: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [inferenceConfig, setInferenceConfig] = useState<GetLocalInferenceConfig200 | null>(null);
  const [models, setModels] = useState<ModelProvider[]>([]);
  const promptRef = useRef<PromptInputRef>(null);
  const pendingPrompt = useRef<PromptInputValue | null>(null);
  const pendingRunInputs = useRef(new Map<string, PromptInputValue>());
  const [chat] = useState(
    () =>
      new Chat<ChatUIMessage>({
        id: initial.id,
        messages: initial.messages as ChatUIMessage[],
        transport,
        generateId: randomId,
        onError: (cause) => {
          const pending = pendingPrompt.current;
          pendingPrompt.current = null;
          if (pending) promptRef.current?.setValue(pending);
          setError(getErrorMessage(cause));
        },
      }),
  );
  const [status, setStatus] = useState(chat.status);
  const [state, setState] = useState({
    title: initial.title,
    status: initial.status,
    turnId: initial.turnId,
    error: initial.error,
    pendingInputs: initial.pendingInputs,
    providerId: initial.providerId,
    reasoningEffort: initial.reasoningEffort,
    contextUsage: initial.contextUsage,
    approvalPolicy: initial.approvalPolicy,
    permissionProfile: initial.permissionProfile,
  });
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
      {
        signal: controller.signal,
        skipErrorNotify: true,
      },
    )
      .then((config) => {
        if (!controller.signal.aborted) setInferenceConfig(config);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [state.providerId, state.reasoningEffort]);
  useEffect(() => {
    const off = bridge.subscribe((event) => {
      if (event.type === "runtime-error") setError(event.message);
      if (event.type === "runtime-ready") {
        setError(null);
        void transport
          .load()
          .then(async (thread) => {
            chat.messages = thread.messages as ChatUIMessage[];
            setState({
              title: thread.title,
              status: thread.status,
              turnId: thread.turnId,
              error: thread.error,
              pendingInputs: thread.pendingInputs,
              providerId: thread.providerId,
              reasoningEffort: thread.reasoningEffort,
              contextUsage: thread.contextUsage,
              approvalPolicy: thread.approvalPolicy,
              permissionProfile: thread.permissionProfile,
            });
            await chat.resumeStream();
          })
          .catch((cause) => setError(getErrorMessage(cause)));
      }
      if (event.type === "thread" && event.thread.id === initial.id) {
        setState({
          title: event.thread.title,
          status: event.thread.status,
          turnId: event.thread.turnId,
          error: event.thread.error,
          pendingInputs: event.thread.pendingInputs,
          providerId: event.thread.providerId,
          reasoningEffort: event.thread.reasoningEffort,
          contextUsage: event.thread.contextUsage,
          approvalPolicy: event.thread.approvalPolicy,
          permissionProfile: event.thread.permissionProfile,
        });
        if (event.thread.status !== "running") chat.messages = event.thread.messages as ChatUIMessage[];
      }
    });
    return () => {
      off();
      transport.dispose();
      void chat.stop();
    };
  }, [bridge, initial.id, transport, chat]);
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
    [bridge, initial.id, transport, chat],
  );
  const busy = state.status === "running" || status === "streaming" || status === "submitted";
  return (
    <ConversationSessionView
      title={state.title}
      chat={chat}
      resume
      scrollRef={scrollRef}
      onStatusChange={setStatus}
      conversationId={initial.id}
      loading={false}
      branches={[]}
      pendingInputs={state.pendingInputs.flatMap((input) =>
        input.state === "accepted" || input.state === "not_delivered" || input.state === "unconfirmed"
          ? [{ id: input.id, text: input.text, mode: input.mode, state: input.state }]
          : [],
      )}
      onToolApproval={(id, accepted) => void approve(id, accepted)}
      onOpenWorkspaceFile={onOpenFile}
      issue={
        error || state.error ? (
          <p role="alert" className="mx-auto w-full max-w-4xl px-4 text-sm text-destructive">
            {error ?? state.error}
          </p>
        ) : null
      }
      composer={
        <ChatPrompt
          ref={promptRef}
          placeholder={busy ? "补充当前任务…" : "发送消息或创建任务…"}
          maxFiles={0}
          onError={setError}
          onSubmit={(value) => {
            if (state.status === "waiting" || !value.text.trim()) return;
            setError(null);
            chat.clearError();
            if (busy) {
              if (!state.turnId) {
                setError("当前轮次缺少标识，请刷新后重试");
                return;
              }
              const messageId = randomId();
              pendingRunInputs.current.set(messageId, value);
              void bridge
                .submitRunInput(initial.id, state.turnId, value.text, messageId, "follow-up")
                .then(() => {
                  pendingRunInputs.current.delete(messageId);
                  if (promptRef.current?.getValue().text === value.text) promptRef.current.clear();
                })
                .catch((cause) => {
                  pendingRunInputs.current.delete(messageId);
                  setError(getErrorMessage(cause));
                });
              return;
            }
            pendingPrompt.current = value;
            promptRef.current?.clear();
            void chat
              .sendMessage({ text: value.text })
              .then(() => {
                pendingPrompt.current = null;
              })
              .catch((cause) => {
                const pending = pendingPrompt.current;
                pendingPrompt.current = null;
                if (pending) promptRef.current?.setValue(pending);
                setError(getErrorMessage(cause));
              });
          }}
          footerRender={() => (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-full"
                aria-label="浏览工作区文件"
                onClick={onOpenFiles}
              >
                <PlusIcon />
              </Button>
              <ChatComposerControls
                models={
                  models.length > 0
                    ? models
                    : [
                        {
                          id: state.providerId,
                          name: inferenceConfig?.providerName ?? inferenceConfig?.model ?? "推理模型",
                        },
                      ]
                }
                selectedModelId={state.providerId}
                onSelectModel={(providerId) => {
                  setError(null);
                  void bridge
                    .setModelBinding(initial.id, providerId, state.reasoningEffort)
                    .then(() => setState((current) => ({ ...current, providerId })))
                    .catch((cause) => setError(getErrorMessage(cause)));
                }}
                reasoningEffort={state.reasoningEffort}
                onReasoningEffortChange={(reasoningEffort) => {
                  setError(null);
                  void bridge
                    .setModelBinding(initial.id, state.providerId, reasoningEffort)
                    .then(() => setState((current) => ({ ...current, reasoningEffort })))
                    .catch((cause) => setError(getErrorMessage(cause)));
                }}
                approvalPolicy={state.approvalPolicy}
                permissionProfile={state.permissionProfile}
                disabled={busy || state.status === "waiting"}
                onExecutionPolicyChange={({ approvalPolicy, permissionProfile }) => {
                  setError(null);
                  void bridge
                    .setExecutionPolicy(initial.id, approvalPolicy, permissionProfile)
                    .catch((cause) => setError(getErrorMessage(cause)));
                }}
              />
              <ContextUsage value={state.contextUsage} loading={busy} />
            </>
          )}
        />
      }
    />
  );
}
