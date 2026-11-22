import { ConversationEmptyState } from "@repo/ai-elements";
import { Button, MessageScrollerItem, Spinner } from "@repo/design-system";
import { memo, useEffect, useMemo, useState } from "react";

import type { ChatUIMessage } from "../lib/chat-message";
import { ChatMessageView, type ChatMessageViewProps } from "./ChatMessageView";
import { PendingInputStack, type PendingAgentInput } from "./PendingInputStack";

type TranscriptMessageRowProps = Omit<ChatMessageViewProps, "message"> & {
  message: ChatUIMessage | null;
  pending: boolean;
};

const TranscriptMessageRow = memo(function TranscriptMessageRow({
  message,
  pending,
  ...props
}: TranscriptMessageRowProps) {
  return (
    <MessageScrollerItem messageId={message?.id} scrollAnchor={message?.role === "user"}>
      {pending || !message ? <ThinkingStatus /> : <ChatMessageView key={message.id} message={message} {...props} />}
    </MessageScrollerItem>
  );
});

type ChatTranscriptProps = Pick<
  ChatMessageViewProps,
  | "conversationId"
  | "onOpenArtifact"
  | "onOpenFile"
  | "onOpenWorkspaceFile"
  | "resolveSourceHref"
  | "resolveSourceAction"
  | "onSelectBranch"
  | "onEditMessage"
  | "onRegenerate"
  | "onAnswerClientTool"
  | "onToolApproval"
  | "onFork"
> & {
  messages: ChatUIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  runActive?: boolean;
  loading: boolean;
  branches: NonNullable<ChatMessageViewProps["branch"]>[];
  pendingInputs?: readonly PendingAgentInput[];
};

function isPendingAssistantMessage(message: ChatUIMessage | undefined) {
  if (message?.role !== "assistant") {
    return false;
  }
  return message.parts.every((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return !part.text.trim();
    }
    return part.type === "step-start";
  });
}

function ThinkingStatus() {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground" role="status" aria-live="polite">
      <Spinner aria-hidden="true" />
      正在思考…
    </div>
  );
}

export const ChatTranscript = memo(function ChatTranscript({
  conversationId,
  messages,
  status,
  runActive = false,
  loading,
  branches,
  pendingInputs = [],
  onOpenArtifact,
  onOpenFile,
  onOpenWorkspaceFile,
  resolveSourceHref,
  resolveSourceAction,
  onSelectBranch,
  onEditMessage,
  onRegenerate,
  onAnswerClientTool,
  onToolApproval,
  onFork,
}: ChatTranscriptProps) {
  const [firstVisibleId, setFirstVisibleId] = useState<string | null>(null);
  const anchorIndex = firstVisibleId === null ? -1 : messages.findIndex((message) => message.id === firstVisibleId);
  const start = anchorIndex < 0 ? Math.max(0, messages.length - 40) : anchorIndex;
  // Anchor by identity: appending a new turn must not evict the row being read.
  useEffect(() => {
    if (anchorIndex < 0) setFirstVisibleId(messages[start]?.id ?? null);
  }, [anchorIndex, messages, start]);
  const visibleMessages: (ChatUIMessage | null)[] = messages.slice(start);
  const busy = runActive || status === "streaming" || status === "submitted";
  const lastMessage = messages.at(-1);
  const pendingAssistantId = busy && isPendingAssistantMessage(lastMessage) ? lastMessage?.id : undefined;
  if (busy && lastMessage?.role === "user") visibleMessages.push(null);
  const branchBySelectedMessage = useMemo(
    () => new Map(branches.map((branch) => [branch.selected_message_id, branch] as const)),
    [branches],
  );
  const deliveredSteeringIds = useMemo(
    () =>
      new Set(
        messages.flatMap((message) =>
          message.parts.flatMap((part) => (part.type === "steering-message" ? [part.id] : [])),
        ),
      ),
    [messages],
  );
  const visiblePendingInputs = pendingInputs.filter((input) => !deliveredSteeringIds.has(input.id));

  return (
    <>
      {start > 0 ? (
        <MessageScrollerItem>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => setFirstVisibleId(messages[Math.max(0, start - 40)].id)}
          >
            显示更早的消息
          </Button>
        </MessageScrollerItem>
      ) : null}
      {loading && messages.length === 0 ? (
        <MessageScrollerItem>
          <ConversationEmptyState title="加载中" description="正在读取会话..." />
        </MessageScrollerItem>
      ) : messages.length === 0 ? (
        <MessageScrollerItem>
          <ConversationEmptyState title="开始对话" description="输入你的问题，或粘贴、拖入文件开始。" />
        </MessageScrollerItem>
      ) : (
        visibleMessages.map((message, index) => {
          const previous = messages[start + index - 1];
          // Keep the reply row mounted between submission and the first assistant delta.
          const key =
            previous?.role === "user" && (!message || message.role === "assistant")
              ? `reply:${previous.id}`
              : `message:${message?.id}`;
          return (
            <TranscriptMessageRow
              key={key}
              message={message}
              pending={message?.id === pendingAssistantId}
              conversationId={conversationId}
              streaming={busy && message?.role === "assistant" && message === lastMessage}
              onOpenArtifact={onOpenArtifact}
              onOpenFile={onOpenFile}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
              resolveSourceHref={resolveSourceHref}
              resolveSourceAction={resolveSourceAction}
              branch={message ? branchBySelectedMessage.get(message.id) : undefined}
              onSelectBranch={onSelectBranch}
              onEditMessage={onEditMessage}
              onRegenerate={onRegenerate}
              onAnswerClientTool={onAnswerClientTool}
              onToolApproval={onToolApproval}
              onFork={onFork}
              busy={busy}
            />
          );
        })
      )}
      <PendingInputStack inputs={visiblePendingInputs} />
    </>
  );
});
