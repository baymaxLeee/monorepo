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
import { lazy, memo, Suspense } from "react";

import type { ChatUIMessage } from "../lib/chat-message";
import { shallowEqualSnapshot, shallowEqualSnapshotList } from "./chat-render-cache";
import { ChatCitedResponse } from "./ChatCitedResponse";
import { ChatFileTag } from "./ChatFileTag";
import { ChatMessageFilePart } from "./ChatMessageFilePart";
const ToolPartView = lazy(() => import("./ChatToolPart").then((m) => ({ default: m.ChatToolPart })));

type ChatMessagePartProps = {
  part: ChatUIMessage["parts"][number];
  sources: SourceItem[];
  partIndex: number;
  conversationId: string;
  streaming: boolean;
  variant: "user" | "assistant";
  onOpenArtifact?: (documentId: string) => void;
  onOpenFile?: (fileId: string) => void;
  onOpenWorkspaceFile?: (path: string) => void;
  resolveSourceHref?: (source: SourceItem) => string | undefined;
  resolveSourceAction?: (source: SourceItem) => (() => Promise<void>) | undefined;
  onOpenImage: (partIndex: number) => void;
  onAnswerClientTool?: (toolName: string, toolCallId: string, output: unknown) => void;
  onToolApproval?: (approvalId: string, approved: boolean) => void;
};

export const ChatMessagePart = memo(function ChatMessagePart({
  part,
  sources,
  partIndex,
  conversationId,
  streaming,
  variant,
  onOpenArtifact,
  onOpenFile,
  onOpenWorkspaceFile,
  resolveSourceHref,
  resolveSourceAction,
  onOpenImage,
  onAnswerClientTool,
  onToolApproval,
}: ChatMessagePartProps) {
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
    const open =
      artifact.workspace_path && onOpenWorkspaceFile
        ? () => onOpenWorkspaceFile(artifact.workspace_path!)
        : onOpenFile
          ? () => onOpenFile(artifact.file_id)
          : undefined;
    return <ChatFileTag filename={artifact.filename} title={artifact.title} onOpen={open} />;
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
          onOpenFile={onOpenFile}
          onAnswerClientTool={onAnswerClientTool}
          onToolApproval={onToolApproval}
        />
      </Suspense>
    );
  }

  return null;
}, sameMessagePartProps);

// ReactChatState snapshots every part with a top-level spread on each delta.
// Compare that public snapshot shape so unchanged siblings keep their subtree.
function sameMessagePartProps(previous: ChatMessagePartProps, next: ChatMessagePartProps) {
  return (
    shallowEqualSnapshot(previous.part, next.part) &&
    shallowEqualSnapshotList(previous.sources, next.sources) &&
    previous.partIndex === next.partIndex &&
    previous.conversationId === next.conversationId &&
    previous.streaming === next.streaming &&
    previous.variant === next.variant &&
    previous.onOpenArtifact === next.onOpenArtifact &&
    previous.onOpenFile === next.onOpenFile &&
    previous.onOpenWorkspaceFile === next.onOpenWorkspaceFile &&
    previous.resolveSourceHref === next.resolveSourceHref &&
    previous.resolveSourceAction === next.resolveSourceAction &&
    previous.onOpenImage === next.onOpenImage &&
    previous.onAnswerClientTool === next.onAnswerClientTool &&
    previous.onToolApproval === next.onToolApproval
  );
}
