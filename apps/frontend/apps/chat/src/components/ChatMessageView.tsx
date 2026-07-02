import { getToolName, isFileUIPart, isToolUIPart, type UIMessage } from "ai";
import type { ConversationDocument } from "api";
import { Button, Checkbox, Input } from "components";
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
import { useState } from "react";
import { cn } from "shared";
import {
  ArtifactDocumentCard,
  ArtifactTaskCard,
  parseArtifactOutput,
  parseArtifactTaskOutput,
} from "./ChatArtifactCard";
import { ChatImageCard } from "./ChatImageCard";
import { ChatMessageFilePart } from "./ChatMessageFilePart";
import { ChatTodoListCard, parseTodoListOutput } from "./ChatTodoListCard";
import { ChatVideoCard } from "./ChatVideoCard";

export interface ChatMessageViewProps {
  message: UIMessage;
  conversationId: string;
  streaming: boolean;
  documents: Map<string, ConversationDocument>;
  latestTodoCallId: string | null;
  onOpenArtifact: (documentId: string) => void;
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
  onContinuePlan: (documentId: string) => void;
  onExecutePlan: (documentId: string) => void;
}

export function ChatMessageView({
  message,
  conversationId,
  streaming,
  documents,
  latestTodoCallId,
  onOpenArtifact,
  onAnswerClientTool,
  onContinuePlan,
  onExecutePlan,
}: ChatMessageViewProps) {
  const reasoning = mergeReasoningParts(message.parts, {
    isMessageStreaming: streaming,
  });
  const allVisibleParts = withoutReasoningParts(message.parts);
  const isUser = message.role === "user";
  const variant = isUser ? "user" : "assistant";

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
              onOpenArtifact={onOpenArtifact}
              onAnswerClientTool={onAnswerClientTool}
              onContinuePlan={onContinuePlan}
              onExecutePlan={onExecutePlan}
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
  onOpenArtifact,
  onAnswerClientTool,
  onContinuePlan,
  onExecutePlan,
}: {
  part: UIMessage["parts"][number];
  conversationId: string;
  streaming: boolean;
  variant: "user" | "assistant";
  documents: Map<string, ConversationDocument>;
  latestTodoCallId: string | null;
  onOpenArtifact: (documentId: string) => void;
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
  onContinuePlan: (documentId: string) => void;
  onExecutePlan: (documentId: string) => void;
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

  if (part.type === "source-url") {
    return (
      <a
        href={part.url}
        target="_blank"
        rel="noreferrer"
        className="block rounded-md border bg-background/70 px-3 py-2 text-xs text-primary hover:underline"
      >
        {part.title ?? part.url}
      </a>
    );
  }

  if (isFileUIPart(part)) {
    return (
      <ChatMessageFilePart
        conversationId={conversationId}
        part={part}
        variant={variant}
        onOpen={onOpenArtifact}
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
        onOpenArtifact={onOpenArtifact}
        onAnswerClientTool={onAnswerClientTool}
        onContinuePlan={onContinuePlan}
        onExecutePlan={onExecutePlan}
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
  onOpenArtifact,
  onAnswerClientTool,
  onContinuePlan,
  onExecutePlan,
}: {
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>;
  conversationId: string;
  documents: Map<string, ConversationDocument>;
  latestTodoCallId: string | null;
  onOpenArtifact: (documentId: string) => void;
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
  onContinuePlan: (documentId: string) => void;
  onExecutePlan: (documentId: string) => void;
}) {
  const toolName = getToolName(part);
  if (toolName === "update_todos" && part.toolCallId !== latestTodoCallId) {
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

  // Generated images/videos render inline (not a generic tool card): their
  // output carries a document_id that would otherwise match the artifact branch.
  if (toolName === "generate_image") {
    return (
      <ChatImageCard
        conversationId={conversationId}
        output={output}
        state={part.state}
        onOpen={onOpenArtifact}
      />
    );
  }

  if (toolName === "generate_video") {
    return (
      <ChatVideoCard
        conversationId={conversationId}
        output={output}
        state={part.state}
        onOpen={onOpenArtifact}
      />
    );
  }

  const outputErrorReason = parseToolOutputError(output);
  const artifact = parseArtifactOutput(output);
  const artifactTask = parseArtifactTaskOutput(output);
  const askUserInput =
    toolName === "ask_user" ? parseAskUserInput(input) : null;
  const todoList =
    toolName === "update_todos" ? parseTodoListOutput(output) : null;

  if (artifact?.documentId) {
    return (
      <ArtifactDocumentCard
        document={documents.get(artifact.documentId)}
        documentId={artifact.documentId}
        fallback={artifact}
        onOpen={() => onOpenArtifact(artifact.documentId)}
        onContinuePlan={() => onContinuePlan(artifact.documentId)}
        onExecutePlan={() => onExecutePlan(artifact.documentId)}
      />
    );
  }

  if (artifactTask) {
    return (
      <ArtifactTaskCard
        task={artifactTask}
        conversationId={conversationId}
        documents={documents}
        onOpen={onOpenArtifact}
      />
    );
  }

  const hasError = part.state === "output-error" || outputErrorReason != null;
  const todoAllDone =
    todoList != null &&
    todoList.todos.length > 0 &&
    todoList.todos.every((item) => item.status === "completed");
  const displayState = hasError
    ? "output-error"
    : todoList != null
      ? todoAllDone
        ? "output-available"
        : "input-available"
      : part.state;
  const isOpenByDefault =
    todoList != null ? !todoAllDone : part.state !== "output-available";

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
        {hasError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
            {errorText?.trim() ||
              outputErrorReason ||
              "工具调用失败，未返回错误详情。"}
          </div>
        ) : null}
        {todoList ? (
          <ChatTodoListCard todos={todoList.todos} />
        ) : (
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

function AskUserToolCard({
  input,
  onSubmit,
}: {
  input: AskUserInput;
  onSubmit: (output: unknown) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const trimmedOther = other.trim();
  const canSubmit =
    input.mode === "multiple"
      ? selected.length > 0 || Boolean(trimmedOther)
      : Boolean(trimmedOther);

  function submitMultiple() {
    const labels = input.choices
      .filter((choice) => selected.includes(choice.value))
      .map((choice) => choice.label);
    onSubmit({
      answers: selected,
      labels,
      ...(trimmedOther ? { other: trimmedOther } : {}),
    });
  }

  function submitOther() {
    if (!trimmedOther) return;
    onSubmit({ answer: trimmedOther, label: input.freeformLabel, other: true });
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
                onClick={() =>
                  onSubmit({ answer: choice.value, label: choice.label })
                }
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
