import {
  Message as AiMessage,
  MessageAction,
  MessageActions,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageToolbar,
  type SourceItem,
} from "@repo/ai-elements";
import { type ConversationDocument, type MessageBranchGroup } from "@repo/api/chat";
import { Button, Spinner } from "@repo/design-system";
import { cn } from "@repo/shared";
import { isFileUIPart, isReasoningFileUIPart, isToolUIPart } from "ai";
import { PencilIcon, RefreshCwIcon, SaveIcon, XIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { ChatUIMessage } from "../lib/chat-message";
import { documentIdFromFilePart } from "../lib/file-parts";
import { useChatStore } from "../store/useChatStore";
import { parseArtifactOutputs } from "./ChatArtifactCard";
import { ChatCheckpoint } from "./ChatCheckpoint";
import { Sources } from "./ChatCitedResponse";
import { ChatMessagePart } from "./ChatMessagePart";
import type { DeliverableCompletion } from "./ChatTodoListCard";

export interface ChatMessageViewProps {
  message: ChatUIMessage;
  onFork?: (messageId: string) => Promise<void>;
  conversationId: string;
  streaming: boolean;
  documents: Map<string, ConversationDocument>;
  latestTodoCallId: string | null;
  deliverableCompletion: DeliverableCompletion;
  onOpenArtifact?: (documentId: string) => void;
  onOpenFile?: (fileId: string) => void;
  onOpenWorkspaceFile?: (path: string) => void;
  resolveSourceHref?: (source: SourceItem) => string | undefined;
  resolveSourceAction?: (source: SourceItem) => (() => Promise<void>) | undefined;
  branch?: MessageBranchGroup;
  onSelectBranch?: (leafMessageId: string) => Promise<void>;
  onEditMessage?: (messageId: string, parts: ChatUIMessage["parts"]) => Promise<void>;
  onRegenerate?: (messageId: string) => Promise<void>;
  onAnswerClientTool?: (toolName: string, toolCallId: string, output: unknown) => void;
  onToolApproval?: (approvalId: string, approved: boolean) => void;
  onExecutePlan?: (fileId: string) => void;
  planExecutedIds: ReadonlySet<string>;
  planBusy: boolean;
}

export function ChatMessageView({
  message,
  onFork,
  conversationId,
  streaming,
  documents,
  latestTodoCallId,
  deliverableCompletion,
  onOpenArtifact,
  onOpenFile,
  onOpenWorkspaceFile,
  resolveSourceHref,
  resolveSourceAction,
  branch,
  onSelectBranch,
  onEditMessage,
  onRegenerate,
  onAnswerClientTool,
  onToolApproval,
  onExecutePlan,
  planExecutedIds,
  planBusy,
}: ChatMessageViewProps) {
  const isUser = message.role === "user";
  const variant = isUser ? "user" : "assistant";
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(() =>
    message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const sources = useMemo(
    () => message.parts.filter((part) => part.type === "source-url" || part.type === "source-document"),
    [message.parts],
  );
  const projectedArtifactIds = useMemo(
    () =>
      new Set(
        message.parts.flatMap((part) =>
          part.type === "data-file" && typeof part.data.file_id === "string" ? [part.data.file_id] : [],
        ),
      ),
    [message.parts],
  );
  const openImagePreview = useChatStore((s) => s.openImagePreview);
  const imageRefs = useMemo(
    () =>
      message.parts.flatMap((part, partIndex) => {
        if ((!isFileUIPart(part) && !isReasoningFileUIPart(part)) || !part.mediaType.startsWith("image/")) {
          return [];
        }
        const documentId = documentIdFromFilePart(part);
        return documentId ? [{ documentId, filename: "filename" in part ? part.filename : undefined, partIndex }] : [];
      }),
    [message.parts],
  );
  const onOpenImage = useCallback(
    (partIndex: number) => {
      const idx = imageRefs.findIndex((ref) => ref.partIndex === partIndex);
      openImagePreview(conversationId, imageRefs, Math.max(idx, 0));
    },
    [conversationId, imageRefs, openImagePreview],
  );

  return (
    <AiMessage from={message.role} className={cn(!isUser && "max-w-full items-stretch")}>
      <MessageContent
        className={cn(isUser ? "flex flex-wrap items-center gap-x-1 gap-y-2 leading-relaxed" : "w-full space-y-3")}
      >
        {message.parts.map((part, index) => {
          const toolFileIds = isToolUIPart(part)
            ? parseArtifactOutputs("output" in part ? part.output : null).flatMap((artifact) =>
                artifact.fileId ? [artifact.fileId] : [],
              )
            : [];
          const agent = isToolUIPart(part) ? part.toolMetadata?.agent : null;
          if (
            streaming &&
            agent &&
            typeof agent === "object" &&
            !Array.isArray(agent) &&
            (agent as Record<string, unknown>).uiKind === "artifact"
          ) {
            return null;
          }
          if (toolFileIds.length > 0 && toolFileIds.every((fileId) => projectedArtifactIds.has(fileId))) return null;
          return (
            <ChatMessagePart
              key={partKey(message.id, part, index)}
              part={part}
              sources={sources}
              partIndex={index}
              conversationId={conversationId}
              streaming={streaming}
              variant={variant}
              documents={documents}
              latestTodoCallId={latestTodoCallId}
              deliverableCompletion={deliverableCompletion}
              onOpenArtifact={onOpenArtifact}
              onOpenFile={onOpenFile}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
              resolveSourceHref={resolveSourceHref}
              resolveSourceAction={resolveSourceAction}
              onOpenImage={onOpenImage}
              onAnswerClientTool={onAnswerClientTool}
              onToolApproval={onToolApproval}
              onExecutePlan={onExecutePlan}
              planExecutedIds={planExecutedIds}
              planBusy={planBusy}
            />
          );
        })}
        {!isUser && (
          <Sources sources={sources} resolveSourceHref={resolveSourceHref} resolveSourceAction={resolveSourceAction} />
        )}
      </MessageContent>
      {editing ? (
        <form
          className="w-full space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editText.trim() || !onEditMessage || actionBusy) return;
            setActionBusy(true);
            setActionError(null);
            void onEditMessage(message.id, editedMessageParts(message.parts, editText))
              .then(() => setEditing(false))
              .catch((error: unknown) => setActionError(error instanceof Error ? error.message : "编辑失败"))
              .finally(() => setActionBusy(false));
          }}
        >
          <label className="sr-only" htmlFor={`edit-${message.id}`}>
            编辑消息
          </label>
          <textarea
            id={`edit-${message.id}`}
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            className="min-h-24 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={actionBusy} onClick={() => setEditing(false)}>
              <XIcon />
              取消
            </Button>
            <Button type="submit" size="sm" disabled={actionBusy || !editText.trim()}>
              {actionBusy ? <Spinner /> : <SaveIcon />}
              保存并重新生成
            </Button>
          </div>
        </form>
      ) : null}
      {!streaming && (onEditMessage || onRegenerate || (branch && onSelectBranch)) ? (
        <MessageToolbar>
          <MessageActions>
            {isUser && onEditMessage ? (
              <MessageAction
                tooltip="编辑消息"
                label="编辑消息"
                disabled={planBusy || actionBusy}
                onClick={() => {
                  setActionError(null);
                  setEditing(true);
                }}
              >
                <PencilIcon />
              </MessageAction>
            ) : null}
            {!isUser && onRegenerate ? (
              <MessageAction
                tooltip="重新生成"
                label="重新生成"
                disabled={planBusy || actionBusy}
                onClick={() => {
                  setActionBusy(true);
                  setActionError(null);
                  void onRegenerate(message.id)
                    .catch((error: unknown) => setActionError(error instanceof Error ? error.message : "重新生成失败"))
                    .finally(() => setActionBusy(false));
                }}
              >
                {actionBusy ? <Spinner /> : <RefreshCwIcon />}
              </MessageAction>
            ) : null}
          </MessageActions>
          {branch && onSelectBranch ? (
            <BranchSelector
              branch={branch}
              busy={planBusy || actionBusy}
              onSelect={async (leafMessageId) => {
                setActionBusy(true);
                setActionError(null);
                try {
                  await onSelectBranch(leafMessageId);
                } catch (error) {
                  setActionError(error instanceof Error ? error.message : "切换候选失败");
                } finally {
                  setActionBusy(false);
                }
              }}
            />
          ) : null}
        </MessageToolbar>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-xs text-destructive">
          {actionError}
        </p>
      ) : null}
      {!isUser && !streaming && onFork && <ChatCheckpoint messageId={message.id} disabled={planBusy} onFork={onFork} />}
    </AiMessage>
  );
}

function editedMessageParts(parts: ChatUIMessage["parts"], text: string): ChatUIMessage["parts"] {
  let replaced = false;
  const next: ChatUIMessage["parts"] = [];
  for (const part of parts) {
    if (part.type !== "text") {
      next.push(part);
      continue;
    }
    if (replaced) continue;
    replaced = true;
    next.push({ ...part, text, state: undefined, citations: undefined });
  }
  if (!replaced) next.unshift({ type: "text", text });
  return next;
}

function BranchSelector({
  branch,
  busy,
  onSelect,
}: {
  branch: MessageBranchGroup;
  busy: boolean;
  onSelect: (leafMessageId: string) => Promise<void>;
}) {
  const selectedIndex = Math.max(
    0,
    branch.candidates.findIndex((candidate) => candidate.message_id === branch.selected_message_id),
  );
  return (
    <MessageBranch
      currentBranch={selectedIndex}
      onBranchChange={(index) => {
        const candidate = branch.candidates[index];
        if (!candidate || candidate.message_id === branch.selected_message_id) return;
        void onSelect(candidate.leaf_message_id);
      }}
    >
      <MessageBranchContent>
        {branch.candidates.map((candidate) => (
          <span key={candidate.message_id} />
        ))}
      </MessageBranchContent>
      <MessageBranchSelector aria-label="消息候选">
        <MessageBranchPrevious disabled={busy} />
        <MessageBranchPage />
        <MessageBranchNext disabled={busy} />
      </MessageBranchSelector>
    </MessageBranch>
  );
}

function partKey(messageId: string, part: ChatUIMessage["parts"][number], index: number) {
  if (isToolUIPart(part)) {
    return `${messageId}-${part.toolCallId}`;
  }
  if (part.type === "reasoning" && part.id) {
    return `${messageId}-${part.id}`;
  }
  return `${messageId}-${part.type}-${index}`;
}
