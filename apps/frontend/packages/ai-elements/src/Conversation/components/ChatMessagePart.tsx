import {
  Reasoning,
  ReasoningAttachmentContent,
  ReasoningContent,
  ReasoningTrigger,
  type SourceItem,
} from "@repo/ai-elements";
import { Badge, Spinner } from "@repo/design-system";
import { isFileUIPart, isReasoningFileUIPart, isToolUIPart } from "ai";
import { SparklesIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import type { ChatUIMessage } from "../lib/chat-message";
import { ChatCitedResponse } from "./ChatCitedResponse";
import { ChatFileTag } from "./ChatFileTag";
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
  deliverableCompletion,
  onOpenArtifact,
  onOpenFile,
  onOpenWorkspaceFile,
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
  deliverableCompletion: DeliverableCompletion;
  onOpenArtifact?: (documentId: string) => void;
  onOpenFile?: (fileId: string) => void;
  onOpenWorkspaceFile?: (path: string) => void;
  resolveSourceHref?: (source: SourceItem) => string | undefined;
  resolveSourceAction?: (source: SourceItem) => (() => Promise<void>) | undefined;
  onOpenImage: (partIndex: number) => void;
  onAnswerClientTool?: (toolName: string, toolCallId: string, output: unknown) => void;
  onToolApproval?: (approvalId: string, approved: boolean) => void;
  onExecutePlan?: (fileId: string) => void;
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

  if (part.type === "steering-message") {
    return (
      <aside className="rounded-xl border border-dashed bg-muted/50 px-3 py-2 text-sm" aria-label="用户补充">
        <span className="mr-2 text-xs font-medium text-muted-foreground">补充</span>
        {part.parts.map((item, index) =>
          item.type === "text" ? (
            <span key={`${part.id}-${index}`} className="whitespace-pre-wrap break-words">
              {item.text}
            </span>
          ) : (
            <span key={`${part.id}-${index}`} className="text-muted-foreground">
              {item.filename ?? "附件"}
            </span>
          ),
        )}
      </aside>
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

  if (part.type === "data-file") {
    const artifact = part.data;
    const open = artifact.workspace_path
      ? onOpenWorkspaceFile
        ? () => onOpenWorkspaceFile(artifact.workspace_path!)
        : undefined
      : onOpenFile
        ? () => onOpenFile(artifact.file_id)
        : undefined;
    return (
      <ChatFileTag
        filename={artifact.filename}
        title={artifact.title}
        onOpen={open}
        onExecute={artifact.kind === "plan" && onExecutePlan ? () => onExecutePlan(artifact.file_id) : undefined}
        executed={planExecutedIds.has(artifact.file_id)}
        busy={planBusy}
      />
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
        onOpenImage={onOpenArtifact ? onOpenImage : undefined}
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
            onOpenImage={onOpenArtifact ? onOpenImage : undefined}
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
          deliverableCompletion={deliverableCompletion}
          onOpenArtifact={onOpenArtifact}
          onAnswerClientTool={onAnswerClientTool}
          onToolApproval={onToolApproval}
        />
      </Suspense>
    );
  }

  return null;
}
