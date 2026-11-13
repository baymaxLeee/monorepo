import { Chat } from "@ai-sdk/react";
import type { ConversationScrollHandle } from "@repo/ai-elements";
import { ChatPrompt, ConversationSessionView, type ChatUIMessage } from "@repo/ai-elements/conversation";
import type { PromptInputRef, PromptInputValue } from "@repo/ai-elements/prompt-input";
import { Button } from "@repo/design-system";
import type { DesktopBridge, LocalThread } from "@repo/runtime/desktop";
import { randomId, getErrorMessage } from "@repo/shared";
import { FolderIcon } from "lucide-react";
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
  const promptRef = useRef<PromptInputRef>(null);
  const pendingPrompt = useRef<PromptInputValue | null>(null);
  const pendingSteers = useRef(new Map<string, PromptInputValue>());
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
  });
  const approving = useRef(false);
  const scrollRef = useRef<ConversationScrollHandle>(null);
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
      headerActions={
        <Button variant="ghost" size="icon-sm" aria-label="查看本地文件" onClick={onOpenFiles}>
          <FolderIcon />
        </Button>
      }
      chat={chat}
      resume
      scrollRef={scrollRef}
      onStatusChange={setStatus}
      conversationId={initial.id}
      loading={false}
      branches={[]}
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
          pendingInputs={state.pendingInputs.flatMap((input) =>
            input.state === "accepted" || input.state === "not_delivered" || input.state === "unconfirmed"
              ? [{ id: input.id, text: input.text, delivery: input.delivery, state: input.state }]
              : [],
          )}
          maxFiles={0}
          onError={setError}
          loading={busy || state.status === "waiting"}
          submitWhileLoading={busy}
          disabled={state.status === "waiting"}
          onStop={() =>
            void Promise.all([chat.stop(), bridge.stop(initial.id)]).catch((cause) => setError(getErrorMessage(cause)))
          }
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
              pendingSteers.current.set(messageId, value);
              void bridge
                .steer(initial.id, state.turnId, value.text, messageId, "steer")
                .then(() => {
                  pendingSteers.current.delete(messageId);
                  if (promptRef.current?.getValue().text === value.text) promptRef.current.clear();
                })
                .catch((cause) => {
                  pendingSteers.current.delete(messageId);
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
            <span className="max-w-48 truncate text-xs text-muted-foreground" title={initial.workspace}>
              {initial.workspace.split("/").at(-1)}
            </span>
          )}
        />
      }
    />
  );
}
