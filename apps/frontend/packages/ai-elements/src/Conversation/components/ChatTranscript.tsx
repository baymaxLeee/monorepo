import { ConversationEmptyState } from "@repo/ai-elements";
import { type ConversationDocument } from "@repo/api/chat";
import { Button, MessageScrollerItem, Spinner } from "@repo/design-system";
import { memo, useEffect, useMemo, useState } from "react";

import type { ChatUIMessage } from "../lib/chat-message";
import { ChatMessageView, type ChatMessageViewProps } from "./ChatMessageView";
import { collectDeliverableCompletion, findLatestUpdateTodosCallId } from "./ChatTodoListCard";

// SDK snapshots preserve historical messages, but derived sets/arrays may be
// recreated on each delta. Compare only that small context, never message text
// or tool payloads; action callbacks still participate in the comparison.
const TranscriptMessage = memo(ChatMessageView, (previous, next) =>
  (Object.keys(previous) as (keyof ChatMessageViewProps)[]).every((key) => {
    if (key === "planExecutedIds") {
      return (
        previous.planExecutedIds.size === next.planExecutedIds.size &&
        [...previous.planExecutedIds].every((path) => next.planExecutedIds.has(path))
      );
    }
    if (key === "deliverableCompletion") {
      return (["artifact", "image", "video"] as const).every((kind) => {
        const before = previous.deliverableCompletion[kind];
        const after = next.deliverableCompletion[kind];
        return before.length === after.length && before.every((status, index) => status === after[index]);
      });
    }
    return previous[key] === next[key];
  }),
);

type ChatTranscriptProps = Pick<
  ChatMessageViewProps,
  | "conversationId"
  | "onOpenArtifact"
  | "onOpenFile"
  | "resolveSourceHref"
  | "resolveSourceAction"
  | "onSelectBranch"
  | "onEditMessage"
  | "onRegenerate"
  | "onAnswerClientTool"
  | "onToolApproval"
  | "onExecutePlan"
  | "onFork"
> & {
  messages: ChatUIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  loading: boolean;
  conversationDocuments: ConversationDocument[];
  branches: NonNullable<ChatMessageViewProps["branch"]>[];
};

function collectExecutedPlanIds(messages: ChatUIMessage[]): Set<string> {
  const executed = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "data-plan-execution") {
        continue;
      }
      const fileId = (part.data as { file_id?: unknown } | undefined)?.file_id;
      if (typeof fileId === "string") {
        executed.add(fileId);
      }
    }
  }
  return executed;
}

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

export const ChatTranscript = memo(function ChatTranscript({
  conversationId,
  messages,
  status,
  loading,
  conversationDocuments,
  branches,
  onOpenArtifact,
  onOpenFile,
  resolveSourceHref,
  resolveSourceAction,
  onSelectBranch,
  onEditMessage,
  onRegenerate,
  onAnswerClientTool,
  onToolApproval,
  onExecutePlan,
  onFork,
}: ChatTranscriptProps) {
  const [firstVisibleId, setFirstVisibleId] = useState<string | null>(null);
  const anchorIndex = firstVisibleId === null ? -1 : messages.findIndex((message) => message.id === firstVisibleId);
  const start = anchorIndex < 0 ? Math.max(0, messages.length - 40) : anchorIndex;
  // Anchor by identity: appending a new turn must not evict the row being read.
  useEffect(() => {
    if (anchorIndex < 0) setFirstVisibleId(messages[start]?.id ?? null);
  }, [anchorIndex, messages, start]);
  const visibleMessages = messages.slice(start);
  const busy = status === "streaming" || status === "submitted";
  const showThinkingPlaceholder =
    status === "submitted" || (status === "streaming" && isPendingAssistantMessage(messages.at(-1)));
  const documents = useMemo(() => {
    const map = new Map<string, ConversationDocument>();
    for (const document of conversationDocuments) {
      map.set(document.id, document);
    }
    return map;
  }, [conversationDocuments]);
  const latestTodoCallId = useMemo(() => findLatestUpdateTodosCallId(messages), [messages]);
  const deliverableCompletion = useMemo(
    () => collectDeliverableCompletion(messages, latestTodoCallId),
    [messages, latestTodoCallId],
  );
  const executedPlanIds = useMemo(() => collectExecutedPlanIds(messages), [messages]);
  const branchBySelectedMessage = useMemo(
    () => new Map(branches.map((branch) => [branch.selected_message_id, branch] as const)),
    [branches],
  );

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
        visibleMessages.map((message) => (
          <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
            <TranscriptMessage
              message={message}
              conversationId={conversationId}
              streaming={busy && message === messages.at(-1)}
              documents={documents}
              latestTodoCallId={latestTodoCallId}
              deliverableCompletion={deliverableCompletion}
              onOpenArtifact={onOpenArtifact}
              onOpenFile={onOpenFile}
              resolveSourceHref={resolveSourceHref}
              resolveSourceAction={resolveSourceAction}
              branch={branchBySelectedMessage.get(message.id)}
              onSelectBranch={onSelectBranch}
              onEditMessage={onEditMessage}
              onRegenerate={onRegenerate}
              onAnswerClientTool={onAnswerClientTool}
              onToolApproval={onToolApproval}
              onExecutePlan={onExecutePlan}
              onFork={onFork}
              planExecutedIds={executedPlanIds}
              planBusy={busy}
            />
          </MessageScrollerItem>
        ))
      )}
      {showThinkingPlaceholder ? (
        <MessageScrollerItem
          className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Spinner aria-hidden="true" />
          正在思考…
        </MessageScrollerItem>
      ) : null}
    </>
  );
});
