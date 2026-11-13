import {
  Reasoning,
  ReasoningAttachmentContent,
  ReasoningContent,
  ReasoningTrigger,
  type SourceItem,
} from "@repo/ai-elements";
import { type ConversationDocument } from "@repo/api/chat";
import { Badge, Spinner } from "@repo/design-system";
import { isFileUIPart, isReasoningFileUIPart, isToolUIPart } from "ai";
import { SparklesIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import type { ChatUIMessage } from "../lib/chat-message";
import { ChatCitedResponse } from "./ChatCitedResponse";
import { ChatMessageFilePart } from "./ChatMessageFilePart";
import type { DeliverableCompletion } from "./ChatTodoListCard";
const ToolPartView = lazy(() => import("./ChatToolPart").then((m) => ({ default: m.ChatToolPart })));

export function ChatMessagePart({
  part,
  sources,
  partIndex,
  conversationId,
  streaming,
  variant,
  documents,
  latestTodoCallId,
  deliverableCompletion,
  onOpenArtifact,
  onOpenFile,
  resolveSourceHref,
  resolveSourceAction,
  onOpenImage,
  onAnswerClientTool,
  onToolApproval,
  onExecutePlan,
  planExecutedIds,
  planBusy,
}: {
  part: ChatUIMessage["parts"][number];
  sources: SourceItem[];
  partIndex: number;
  conversationId: string;
  streaming: boolean;
  variant: "user" | "assistant";
  documents: Map<string, ConversationDocument>;
  latestTodoCallId: string | null;
  deliverableCompletion: DeliverableCompletion;
  onOpenArtifact: (documentId: string) => void;
  onOpenFile: (fileId: string) => void;
  resolveSourceHref?: (source: SourceItem) => string | undefined;
  resolveSourceAction?: (source: SourceItem) => (() => Promise<void>) | undefined;
  onOpenImage: (partIndex: number) => void;
  onAnswerClientTool: (toolName: string, toolCallId: string, output: unknown) => void;
  onToolApproval: (approvalId: string, approved: boolean) => void;
  onExecutePlan: (fileId: string) => void;
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
    return (
      <ChatCitedResponse
        text={part.text}
        streaming={streaming}
        sources={sources}
        citations={part.citations}
        resolveSourceHref={resolveSourceHref}
        resolveSourceAction={resolveSourceAction}
      />
    );
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

  if (isFileUIPart(part)) {
    return (
      <ChatMessageFilePart
        part={part}
        conversationId={conversationId}
        partIndex={partIndex}
        variant={variant}
        onOpenArtifact={onOpenArtifact}
        onOpenFile={onOpenFile}
        onOpenImage={onOpenImage}
      />
    );
  }

  if (isReasoningFileUIPart(part)) {
    return (
      <Reasoning defaultOpen={false}>
        <ReasoningTrigger>推理附件</ReasoningTrigger>
        <ReasoningAttachmentContent>
          <ChatMessageFilePart
            part={part}
            conversationId={conversationId}
            partIndex={partIndex}
            variant={variant}
            onOpenArtifact={onOpenArtifact}
            onOpenFile={onOpenFile}
            onOpenImage={onOpenImage}
          />
        </ReasoningAttachmentContent>
      </Reasoning>
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
