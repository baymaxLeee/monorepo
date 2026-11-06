import {
  Message as AiMessage,
  MessageContent,
  MessageResponse,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@repo/ai-elements";
import type { ConversationDocument } from "@repo/api";
import { Badge, Spinner } from "@repo/design-system";
import { cn, isPublicHttpUrl } from "@repo/shared";
import { isFileUIPart, isToolUIPart, type UIMessage } from "ai";
import { SparklesIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useMemo } from "react";

import { documentIdFromFilePart } from "../lib/file-parts";
import { useChatStore } from "../store/useChatStore";
import { ChatMessageFilePart } from "./ChatMessageFilePart";
import type { DeliverableCompletion } from "./ChatTodoListCard";

const ToolPartView = lazy(() => import("./ChatToolPart").then((m) => ({ default: m.ChatToolPart })));

export interface ChatMessageViewProps {
  message: UIMessage;
  conversationId: string;
  streaming: boolean;
  documents: Map<string, ConversationDocument>;
  latestTodoCallId: string | null;
  deliverableCompletion: DeliverableCompletion;
  onOpenArtifact: (documentId: string) => void;
  onOpenFile: (path: string) => void;
  onAnswerClientTool: (toolName: string, toolCallId: string, output: unknown) => void;
  onToolApproval: (approvalId: string, approved: boolean) => void;
  onExecutePlan: (documentId: string) => void;
  planExecutedIds: ReadonlySet<string>;
  planBusy: boolean;
}

export function ChatMessageView({
  message,
  conversationId,
  streaming,
  documents,
  latestTodoCallId,
  deliverableCompletion,
  onOpenArtifact,
  onOpenFile,
  onAnswerClientTool,
  onToolApproval,
  onExecutePlan,
  planExecutedIds,
  planBusy,
}: ChatMessageViewProps) {
  const isUser = message.role === "user";
  const variant = isUser ? "user" : "assistant";

  const openImagePreview = useChatStore((s) => s.openImagePreview);
  const imageRefs = useMemo(
    () =>
      message.parts.flatMap((part, partIndex) => {
        if (!isFileUIPart(part) || !part.mediaType.startsWith("image/")) {
          return [];
        }
        const documentId = documentIdFromFilePart(part);
        return documentId ? [{ documentId, filename: part.filename, partIndex }] : [];
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
        {message.parts.map((part, index) => (
          <MessagePartView
            key={partKey(message.id, part, index)}
            part={part}
            partIndex={index}
            conversationId={conversationId}
            streaming={streaming}
            variant={variant}
            documents={documents}
            latestTodoCallId={latestTodoCallId}
            deliverableCompletion={deliverableCompletion}
            onOpenArtifact={onOpenArtifact}
            onOpenFile={onOpenFile}
            onOpenImage={onOpenImage}
            onAnswerClientTool={onAnswerClientTool}
            onToolApproval={onToolApproval}
            onExecutePlan={onExecutePlan}
            planExecutedIds={planExecutedIds}
            planBusy={planBusy}
          />
        ))}
      </MessageContent>
    </AiMessage>
  );
}

function partKey(messageId: string, part: UIMessage["parts"][number], index: number) {
  if (isToolUIPart(part)) {
    return `${messageId}-${part.toolCallId}`;
  }
  if (part.type === "reasoning" && part.id) {
    return `${messageId}-${part.id}`;
  }
  return `${messageId}-${part.type}-${index}`;
}

function MessagePartView({
  part,
  partIndex,
  conversationId,
  streaming,
  variant,
  documents,
  latestTodoCallId,
  deliverableCompletion,
  onOpenArtifact,
  onOpenFile,
  onOpenImage,
  onAnswerClientTool,
  onToolApproval,
  onExecutePlan,
  planExecutedIds,
  planBusy,
}: {
  part: UIMessage["parts"][number];
  partIndex: number;
  conversationId: string;
  streaming: boolean;
  variant: "user" | "assistant";
  documents: Map<string, ConversationDocument>;
  latestTodoCallId: string | null;
  deliverableCompletion: DeliverableCompletion;
  onOpenArtifact: (documentId: string) => void;
  onOpenFile: (path: string) => void;
  onOpenImage: (partIndex: number) => void;
  onAnswerClientTool: (toolName: string, toolCallId: string, output: unknown) => void;
  onToolApproval: (approvalId: string, approved: boolean) => void;
  onExecutePlan: (documentId: string) => void;
  planExecutedIds: ReadonlySet<string>;
  planBusy: boolean;
}) {
  if (part.type === "reasoning") {
    const isReasoningStreaming = streaming && part.state === "streaming";
    if (!isReasoningStreaming && !part.text.trim()) {
      return null;
    }
    return (
      <Reasoning isStreaming={isReasoningStreaming}>
        <ReasoningTrigger />
        <ReasoningContent>{part.text}</ReasoningContent>
      </Reasoning>
    );
  }

  if (part.type === "text") {
    if (variant === "user") {
      return <span className="whitespace-pre-wrap break-words">{part.text}</span>;
    }
    return <MessageResponse isAnimating={streaming}>{part.text}</MessageResponse>;
  }

  if (part.type === "data-skill-activation") {
    const name = (part.data as { name?: unknown } | undefined)?.name;
    if (typeof name !== "string" || !name) {
      return null;
    }
    return (
      <Badge variant="secondary" className="h-6 gap-1 rounded-full px-2 font-mono text-xs">
        <SparklesIcon className="size-3" />
        {name}
      </Badge>
    );
  }

  if (part.type === "source-url") {
    const href = isPublicHttpUrl(part.url) ? part.url : undefined;
    if (!href) {
      return (
        <div className="block rounded-md border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
          {part.title ?? "链接不可用"}
        </div>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="block rounded-md border bg-background/70 px-3 py-2 text-xs text-primary hover:underline"
      >
        {part.title ?? href}
      </a>
    );
  }

  if (isFileUIPart(part)) {
    return (
      <ChatMessageFilePart
        part={part}
        conversationId={conversationId}
        partIndex={partIndex}
        variant={variant}
        onOpen={onOpenArtifact}
        onOpenImage={onOpenImage}
      />
    );
  }

  if (isToolUIPart(part)) {
    return (
      <Suspense
        fallback={
          <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            加载工具…
          </span>
        }
      >
        <ToolPartView
          part={part}
          conversationId={conversationId}
          documents={documents}
          latestTodoCallId={latestTodoCallId}
          deliverableCompletion={deliverableCompletion}
          onOpenArtifact={onOpenArtifact}
          onOpenFile={onOpenFile}
          onAnswerClientTool={onAnswerClientTool}
          onToolApproval={onToolApproval}
          onExecutePlan={onExecutePlan}
          planExecutedIds={planExecutedIds}
          planBusy={planBusy}
        />
      </Suspense>
    );
  }

  return null;
}
