import { Chat } from "@ai-sdk/react";
import type { ConversationScrollHandle } from "@repo/ai-elements";
import { ExecutionLocation, ChatPrompt, ChatStream, type ChatUIMessage } from "@repo/ai-elements/conversation";
import type { PromptInputRef } from "@repo/ai-elements/prompt-input";
import type { DesktopBridge, LocalThread } from "@repo/runtime/desktop";
import { randomId, getErrorMessage } from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LocalChatTransport } from "./transport";

const noop = () => {};
export function LocalMessages({
  bridge,
  initial,
  transport,
}: {
  bridge: DesktopBridge;
  initial: LocalThread;
  transport: LocalChatTransport;
}) {
  const [error, setError] = useState<string | null>(null);
  const [chat] = useState(
    () =>
      new Chat<ChatUIMessage>({
        id: initial.id,
        messages: initial.messages as ChatUIMessage[],
        transport,
        generateId: randomId,
        onError: (cause) => setError(getErrorMessage(cause)),
      }),
  );
  const [status, setStatus] = useState(chat.status);
  const [state, setState] = useState({ status: initial.status, error: initial.error });
  const approving = useRef(false);
  const promptRef = useRef<PromptInputRef>(null);
  const scrollRef = useRef<ConversationScrollHandle>(null);
  useEffect(() => {
    const off = bridge.subscribe((event) => {
      if (event.type === "runtime-error") setError(event.message);
      if (event.type === "thread" && event.thread.id === initial.id) {
        setState({ status: event.thread.status, error: event.thread.error });
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatStream
        chat={chat}
        resume
        scrollRef={scrollRef}
        onStatusChange={setStatus}
        conversationId={initial.id}
        loading={false}
        conversationDocuments={[]}
        branches={[]}
        onOpenArtifact={noop}
        onOpenFile={noop}
        onAnswerClientTool={noop}
        onToolApproval={(id, accepted) => void approve(id, accepted)}
        onExecutePlan={noop}
      />
      {error || state.error ? (
        <p role="alert" className="mx-auto w-full max-w-4xl px-4 text-sm text-destructive">
          {error ?? state.error}
        </p>
      ) : null}
      <ChatPrompt
        ref={promptRef}
        placeholder="要求后续变更"
        maxFiles={0}
        onError={setError}
        loading={busy || state.status === "waiting"}
        disabled={state.status === "waiting"}
        onStop={() =>
          void Promise.all([chat.stop(), bridge.stop(initial.id)]).catch((cause) => setError(getErrorMessage(cause)))
        }
        onSubmit={(value) => {
          if (busy || state.status === "waiting" || !value.text.trim()) return;
          setError(null);
          chat.clearError();
          void chat
            .sendMessage({ text: value.text })
            .then(() => promptRef.current?.clear())
            .catch((cause) => setError(getErrorMessage(cause)));
        }}
        footerRender={() => (
          <>
            <ExecutionLocation value="local" localAvailable />
            <span className="max-w-48 truncate text-xs text-muted-foreground" title={initial.workspace}>
              {initial.workspace.split("/").at(-1)}
            </span>
          </>
        )}
      />
    </div>
  );
}
