import { getToolName, isFileUIPart, isToolUIPart, type UIMessage } from "ai";
import type { ConversationDocument } from "api";
import { Badge, Button, Checkbox, Input } from "components";
import {
  Message as AiMessage,
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
import { useCallback, useMemo, useState } from "react";
import { cn, isPublicHttpUrl } from "shared";
import { documentIdFromFilePart } from "../lib/file-parts";
import { useChatStore } from "../store/useChatStore";
import {
  ArtifactDocumentCard,
  ArtifactTaskCard,
  parseArtifactOutput,
  parseArtifactTaskOutput,
} from "./ChatArtifactCard";
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
  const imageGroup = useMemo(
    () =>
      message.parts.flatMap((part) => {
        if (!isFileUIPart(part) || !part.mediaType.startsWith("image/")) {
          return [];
        }
        const documentId = documentIdFromFilePart(part);
        return documentId ? [{ documentId, filename: part.filename }] : [];
      }),
    [message.parts],
  );
  const onOpenImage = useCallback(
    (documentId: string) => {
      const idx = imageGroup.findIndex((ref) => ref.documentId === documentId);
      openImagePreview(conversationId, imageGroup, Math.max(idx, 0));
    },
    [conversationId, imageGroup, openImagePreview],
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
              conversationId={conversationId}
              streaming={streaming}
              variant={variant}
              documents={documents}
              latestTodoCallId={latestTodoCallId}
              deliverableCompletion={deliverableCompletion}
              onOpenArtifact={onOpenArtifact}
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
  conversationId,
  streaming,
  variant,
  documents,
  latestTodoCallId,
  deliverableCompletion,
  onOpenArtifact,
  onOpenImage,
  onAnswerClientTool,
  onToolApproval,
  onExecutePlan,
  planExecutedIds,
  planBusy,
}: {
  part: UIMessage["parts"][number];
  conversationId: string;
  streaming: boolean;
  variant: "user" | "assistant";
  documents: Map<string, ConversationDocument>;
  latestTodoCallId: string | null;
  deliverableCompletion: DeliverableCompletion;
  onOpenArtifact: (documentId: string) => void;
  onOpenImage: (documentId: string) => void;
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
            <div className="flex gap-2 p-3">
              <Button
                size="sm"
                onClick={() => onToolApproval(part.approval.id, true)}
              >
                允许
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onToolApproval(part.approval.id, false)}
              >
                拒绝
              </Button>
            </div>
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
          <div className="p-3 text-xs text-muted-foreground">
            {part.state === "output-denied"
              ? "工具调用已被拒绝。"
              : part.approval.approved
                ? "工具调用已授权。"
                : "工具调用未获授权。"}
          </div>
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
        output={output}
        state={part.state}
        errorText={errorText}
        onOpen={onOpenArtifact}
      />
    );
  }

  const outputErrorReason =
    toolName === "html_validate" ? null : parseToolOutputError(output);
  const artifact = kind === "artifact" ? parseArtifactOutput(output) : null;
  const artifactTask =
    kind === "artifact" ? parseArtifactTaskOutput(output) : null;
  const askUserInput = kind === "ask-user" ? parseAskUserInput(input) : null;
  const todoList = kind === "todo-list" ? parseTodoListOutput(output) : null;

  if (artifact?.documentId) {
    return (
      <ArtifactDocumentCard
        document={documents.get(artifact.documentId)}
        documentId={artifact.documentId}
        fallback={artifact}
        planExecuted={planExecutedIds.has(artifact.documentId)}
        planBusy={planBusy}
        onOpen={() => onOpenArtifact(artifact.documentId)}
        onExecutePlan={() => onExecutePlan(artifact.documentId)}
      />
    );
  }

  if (artifactTask) {
    return (
      <ArtifactTaskCard
        task={artifactTask}
        documents={documents}
        onOpen={onOpenArtifact}
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
        {kind === "ask-user" && part.state === "output-available" ? (
          <AskUserAnsweredCard
            question={askUserInput?.question}
            input={askUserInput}
            output={output}
          />
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
  if (!output || typeof output !== "object") return null;
  const row = output as { ok?: unknown; error?: unknown };
  if (row.ok !== false) return null;
  if (typeof row.error === "string" && row.error.trim())
    return row.error.trim();
  return "工具调用失败，未返回具体原因。";
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

type AskUserInput = {
  question: string;
  choices: Array<{ label: string; value: string }>;
  mode: "single" | "multiple";
  allowFreeform: boolean;
  freeformLabel: string;
};

function parseAskUserInput(input: unknown): AskUserInput | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as {
    question?: unknown;
    choices?: unknown;
    mode?: unknown;
    allow_freeform?: unknown;
    freeform_label?: unknown;
  };
  if (typeof raw.question !== "string" || !raw.question.trim()) return null;
  const choices = Array.isArray(raw.choices)
    ? raw.choices
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const choice = item as { label?: unknown; value?: unknown };
          if (
            typeof choice.label !== "string" ||
            typeof choice.value !== "string"
          ) {
            return null;
          }
          return { label: choice.label, value: choice.value };
        })
        .filter(
          (item): item is { label: string; value: string } => item != null,
        )
    : [];
  return {
    question: raw.question,
    choices,
    mode: raw.mode === "multiple" ? "multiple" : "single",
    allowFreeform: raw.allow_freeform !== false,
    freeformLabel:
      typeof raw.freeform_label === "string" && raw.freeform_label.trim()
        ? raw.freeform_label.trim()
        : "其他",
  };
}

function parseAskUserAnswer(output: unknown): string {
  // ask_user now returns the answer as plain text (multiple selections are
  // joined on submit). The object branch only tolerates conversations
  // persisted before that change.
  if (typeof output === "string") return output.trim();
  if (!output || typeof output !== "object") return "";
  const raw = output as {
    answer?: unknown;
    label?: unknown;
    answers?: unknown;
    labels?: unknown;
    other?: unknown;
  };
  if (Array.isArray(raw.labels) || Array.isArray(raw.answers)) {
    const source = Array.isArray(raw.labels) ? raw.labels : raw.answers;
    const values = (source as unknown[]).filter(
      (item): item is string => typeof item === "string" && item.trim() !== "",
    );
    if (typeof raw.other === "string" && raw.other.trim()) {
      values.push(raw.other.trim());
    }
    return values.join("、");
  }
  if (raw.other !== true && typeof raw.label === "string" && raw.label.trim()) {
    return raw.label.trim();
  }
  if (typeof raw.answer === "string" && raw.answer.trim()) {
    return raw.answer.trim();
  }
  return typeof raw.label === "string" ? raw.label.trim() : "";
}

function answerToLabels(answer: string, input: AskUserInput | null): string {
  if (!input || input.choices.length === 0) return answer;
  const valueToLabel = new Map(
    input.choices.map((choice) => [choice.value, choice.label] as const),
  );
  return answer
    .split("、")
    .map((token) => valueToLabel.get(token.trim()) ?? token)
    .join("、");
}

function AskUserAnsweredCard({
  question,
  input,
  output,
}: {
  question?: string;
  input: AskUserInput | null;
  output: unknown;
}) {
  const answer = answerToLabels(parseAskUserAnswer(output), input);
  if (!answer) return <ToolJsonBlock value={output} />;
  return (
    <div className="space-y-1.5 rounded-md border bg-muted/30 p-3">
      {question ? (
        <div className="text-xs text-muted-foreground">{question}</div>
      ) : null}
      <div className="whitespace-pre-wrap break-words text-sm">{answer}</div>
    </div>
  );
}

function AskUserToolCard({
  input,
  onSubmit,
}: {
  input: AskUserInput;
  onSubmit: (answer: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const trimmedOther = other.trim();
  const canSubmit =
    input.mode === "multiple"
      ? selected.length > 0 || Boolean(trimmedOther)
      : Boolean(trimmedOther);

  function submitMultiple() {
    const values = input.choices
      .filter((choice) => selected.includes(choice.value))
      .map((choice) => choice.value);
    if (trimmedOther) values.push(trimmedOther);
    onSubmit(values.join("、"));
  }

  function submitOther() {
    if (!trimmedOther) return;
    onSubmit(trimmedOther);
    setOther("");
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="text-sm font-medium leading-relaxed">
        {input.question}
      </div>
      {input.choices.length > 0 ? (
        input.mode === "multiple" ? (
          <div className="space-y-2">
            {input.choices.map((choice) => {
              const checked = selected.includes(choice.value);
              return (
                <button
                  key={choice.value}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm"
                  onClick={() => {
                    setSelected((current) =>
                      checked
                        ? current.filter((item) => item !== choice.value)
                        : [...current, choice.value],
                    );
                  }}
                >
                  <Checkbox
                    checked={checked}
                    aria-label={choice.label}
                    tabIndex={-1}
                  />
                  <span>{choice.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {input.choices.map((choice) => (
              <Button
                key={choice.value}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onSubmit(choice.value)}
              >
                {choice.label}
              </Button>
            ))}
          </div>
        )
      ) : null}
      {input.allowFreeform ? (
        <div className="flex gap-2">
          <Input
            value={other}
            onChange={(event) => setOther(event.target.value)}
            placeholder={input.freeformLabel}
          />
          <Button
            type="button"
            variant={input.mode === "multiple" ? "outline" : "default"}
            disabled={!canSubmit}
            onClick={input.mode === "multiple" ? submitMultiple : submitOther}
          >
            提交
          </Button>
        </div>
      ) : input.mode === "multiple" ? (
        <Button
          type="button"
          size="sm"
          disabled={!canSubmit}
          onClick={submitMultiple}
        >
          提交
        </Button>
      ) : null}
    </div>
  );
}
