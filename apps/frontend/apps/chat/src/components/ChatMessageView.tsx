import { getToolName, isFileUIPart, isToolUIPart, type UIMessage } from "ai";
import type { ConversationDocument } from "api";
import { Badge } from "components";
import {
  Message as AiMessage,
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
  MessageContent,
  MessageResponse,
  mergeReasoningParts,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Tool,
  ToolContent,
  ToolHeader,
  ToolJsonBlock,
  withoutReasoningParts,
} from "components/ai-chat";
import { SparklesIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { cn, isPublicHttpUrl } from "shared";
import { parseAskUserInput } from "../lib/ask-user";
import { documentIdFromFilePart } from "../lib/file-parts";
import { parseToolOutcome } from "../lib/tool-outcome";
import { useChatStore } from "../store/useChatStore";
import { AskUserAnsweredCard } from "./AskUserAnsweredCard";
import { AskUserToolCard } from "./AskUserToolCard";
import {
  ArtifactDocumentCard,
  ArtifactTaskCard,
  parseArtifactOutput,
  parseArtifactTaskOutput,
} from "./ChatArtifactCard";
import { ArtifactFileCard } from "./ChatFileArtifactCard";
import { ChatImageCard } from "./ChatImageCard";
import { ChatMessageFilePart } from "./ChatMessageFilePart";
import {
  ChatTodoListCard,
  type DeliverableCompletion,
  isTodoListSettled,
  parseTodoListOutput,
} from "./ChatTodoListCard";
import { ChatVideoCard } from "./ChatVideoCard";

export interface ChatMessageViewProps {
  message: UIMessage;
  conversationId: string;
  streaming: boolean;
  documents: Map<string, ConversationDocument>;
  latestTodoCallId: string | null;
  deliverableCompletion: DeliverableCompletion;
  onOpenArtifact: (documentId: string) => void;
  onOpenFile: (path: string) => void;
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
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
  const reasoning = mergeReasoningParts(message.parts, {
    isMessageStreaming: streaming,
  });
  const allVisibleParts = withoutReasoningParts(message.parts);
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
        return documentId
          ? [{ documentId, filename: part.filename, partIndex }]
          : [];
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
    <AiMessage
      from={message.role}
      className={cn(!isUser && "max-w-full items-stretch")}
    >
      <MessageContent className={cn(!isUser && "w-full")}>
        <div
          className={cn(
            isUser
              ? "flex flex-wrap items-center gap-x-1 gap-y-2 leading-relaxed"
              : "space-y-3",
          )}
        >
          {reasoning ? (
            <Reasoning isStreaming={reasoning.isStreaming}>
              <ReasoningTrigger />
              <ReasoningContent>{reasoning.text}</ReasoningContent>
            </Reasoning>
          ) : null}
          {allVisibleParts.map(({ part, index }) => (
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
        </div>
      </MessageContent>
    </AiMessage>
  );
}

function partKey(
  messageId: string,
  part: UIMessage["parts"][number],
  index: number,
) {
  if (isToolUIPart(part)) return `${messageId}-${part.toolCallId}`;
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
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
  onToolApproval: (approvalId: string, approved: boolean) => void;
  onExecutePlan: (documentId: string) => void;
  planExecutedIds: ReadonlySet<string>;
  planBusy: boolean;
}) {
  if (part.type === "text") {
    if (variant === "user") {
      return (
        <span className="whitespace-pre-wrap break-words">{part.text}</span>
      );
    }
    return (
      <MessageResponse isAnimating={streaming}>{part.text}</MessageResponse>
    );
  }

  if (part.type === "reasoning") {
    return null;
  }

  if (part.type === "data-skill-activation") {
    const name = (part.data as { name?: unknown } | undefined)?.name;
    if (typeof name !== "string" || !name) return null;
    return (
      <Badge
        variant="secondary"
        className="h-6 gap-1 rounded-full px-2 font-mono text-xs"
      >
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
    );
  }

  return null;
}

function ToolPartView({
  part,
  conversationId,
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
}: {
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>;
  conversationId: string;
  documents: Map<string, ConversationDocument>;
  latestTodoCallId: string | null;
  deliverableCompletion: DeliverableCompletion;
  onOpenArtifact: (documentId: string) => void;
  onOpenFile: (path: string) => void;
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
  onToolApproval: (approvalId: string, approved: boolean) => void;
  onExecutePlan: (documentId: string) => void;
  planExecutedIds: ReadonlySet<string>;
  planBusy: boolean;
}) {
  const toolName = getToolName(part);
  const kind = toolUiKind(part);
  if (toolIsInternal(part)) return null;
  if (kind === "todo-list" && part.toolCallId !== latestTodoCallId) {
    return null;
  }
  const input = "input" in part ? part.input : undefined;
  const rawInput =
    "rawInput" in part ? compactRawInput(part.rawInput) : undefined;
  const output = "output" in part ? part.output : undefined;
  const errorText =
    "errorText" in part && typeof part.errorText === "string"
      ? part.errorText
      : undefined;

  if (part.state === "approval-requested") {
    return (
      <Tool open>
        <ToolHeader title={toolName} state={part.state} />
        <ToolContent>
          <ToolJsonBlock value={input} />
          {part.approval.isAutomatic ? (
            <div className="text-xs text-muted-foreground">
              正在检查工具授权策略…
            </div>
          ) : (
            <Confirmation approval={part.approval} state={part.state}>
              <ConfirmationRequest>
                <ConfirmationTitle>
                  此工具需要你的授权后才能继续执行。
                </ConfirmationTitle>
                <ConfirmationActions>
                  <ConfirmationAction
                    variant="outline"
                    onClick={() => onToolApproval(part.approval.id, false)}
                  >
                    拒绝
                  </ConfirmationAction>
                  <ConfirmationAction
                    onClick={() => onToolApproval(part.approval.id, true)}
                  >
                    允许
                  </ConfirmationAction>
                </ConfirmationActions>
              </ConfirmationRequest>
            </Confirmation>
          )}
        </ToolContent>
      </Tool>
    );
  }

  if (part.state === "approval-responded" || part.state === "output-denied") {
    return (
      <Tool open={part.state === "output-denied"}>
        <ToolHeader title={toolName} state={part.state} />
        <ToolContent>
          <Confirmation approval={part.approval} state={part.state}>
            <ConfirmationAccepted>
              <ConfirmationTitle>工具调用已授权。</ConfirmationTitle>
            </ConfirmationAccepted>
            <ConfirmationRejected>
              <ConfirmationTitle>工具调用已被拒绝。</ConfirmationTitle>
            </ConfirmationRejected>
          </Confirmation>
        </ToolContent>
      </Tool>
    );
  }

  if (kind === "image-gallery") {
    return (
      <ChatImageCard
        conversationId={conversationId}
        output={output}
        state={part.state}
        errorText={errorText}
      />
    );
  }

  if (kind === "video") {
    return (
      <ChatVideoCard
        conversationId={conversationId}
        output={output}
        state={part.state}
        errorText={errorText}
        onOpen={onOpenArtifact}
      />
    );
  }

  const outputErrorReason = parseToolOutputError(output);
  const artifact = kind === "artifact" ? parseArtifactOutput(output) : null;
  const artifactTask =
    kind === "artifact" ? parseArtifactTaskOutput(output) : null;
  const askUserInput = kind === "ask-user" ? parseAskUserInput(input) : null;
  const todoList = kind === "todo-list" ? parseTodoListOutput(output) : null;

  if (artifact?.documentId) {
    const documentId = artifact.documentId;
    return (
      <ArtifactDocumentCard
        document={documents.get(documentId)}
        documentId={documentId}
        fallback={artifact}
        planExecuted={planExecutedIds.has(documentId)}
        planBusy={planBusy}
        onOpen={() => onOpenArtifact(documentId)}
        onExecutePlan={() => onExecutePlan(documentId)}
      />
    );
  }

  if (artifact?.path) {
    const path = artifact.path;
    return (
      <ArtifactFileCard
        artifact={{ ...artifact, path }}
        planExecuted={planExecutedIds.has(path)}
        planBusy={planBusy}
        onOpen={() => onOpenFile(path)}
        onExecutePlan={() => onExecutePlan(path)}
      />
    );
  }

  if (artifactTask) {
    return (
      <ArtifactTaskCard
        task={artifactTask}
        documents={documents}
        onOpen={onOpenArtifact}
        onOpenFile={onOpenFile}
      />
    );
  }

  const hasError = part.state === "output-error" || outputErrorReason != null;
  const todoSettled =
    todoList != null &&
    isTodoListSettled(todoList.todos, deliverableCompletion);
  const displayState = hasError
    ? "output-error"
    : todoList != null
      ? todoSettled
        ? "output-available"
        : "input-available"
      : part.state;
  const isOpenByDefault =
    todoList != null ? !todoSettled : part.state !== "output-available";

  return (
    <Tool open={isOpenByDefault || outputErrorReason != null}>
      <ToolHeader title={toolName} state={displayState} />
      <ToolContent>
        {part.state === "input-available" && askUserInput ? (
          <AskUserToolCard
            input={askUserInput}
            onSubmit={(answer) =>
              onAnswerClientTool(toolName, part.toolCallId, answer)
            }
          />
        ) : null}
        {kind === "ask-user" &&
        part.state === "output-available" &&
        askUserInput ? (
          <AskUserAnsweredCard input={askUserInput} output={output} />
        ) : null}
        {hasError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            {errorText?.trim() ||
              outputErrorReason ||
              "工具调用失败，未返回错误详情。"}
          </div>
        ) : null}
        {todoList ? (
          <ChatTodoListCard
            todos={todoList.todos}
            deliverableCompletion={deliverableCompletion}
          />
        ) : kind === "ask-user" ? null : (
          <>
            {askUserInput == null && input !== undefined ? (
              <ToolJsonBlock value={input} />
            ) : null}
            {askUserInput == null &&
            input === undefined &&
            rawInput !== undefined ? (
              <ToolJsonBlock value={{ rawInput }} />
            ) : null}
            {askUserInput == null && output !== undefined ? (
              <ToolJsonBlock value={output} />
            ) : null}
          </>
        )}
      </ToolContent>
    </Tool>
  );
}

function toolUiKind(
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>,
): string | null {
  if (!("toolMetadata" in part) || !part.toolMetadata) return null;
  const agent = part.toolMetadata.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return null;
  const value = agent as Record<string, unknown>;
  return typeof value.uiKind === "string" ? value.uiKind : null;
}

function toolIsInternal(
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>,
): boolean {
  if (!("toolMetadata" in part) || !part.toolMetadata) return false;
  const agent = part.toolMetadata.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return false;
  return (agent as Record<string, unknown>).visibility === "internal";
}

function parseToolOutputError(output: unknown): string | null {
  const outcome = parseToolOutcome(output);
  return outcome && outcome.ok === false ? outcome.error.message : null;
}

function compactRawInput(rawInput: unknown) {
  if (typeof rawInput !== "string") return rawInput;
  const contentMatch = rawInput.match(/"content"\s*:\s*"([\s\S]*)/);
  if (!contentMatch?.[1]) return rawInput;
  return rawInput.replace(
    /"content"\s*:\s*"[\s\S]*/m,
    `"content":"[redacted malformed artifact content: ${contentMatch[1].length} chars]"`,
  );
}
