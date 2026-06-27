import { getToolName, isToolUIPart, type UIMessage } from "ai";
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
import { useState } from "react";
import {
  ArtifactDocumentCard,
  parseArtifactOutput,
  parseArtifactStreamData,
  StreamingArtifactCard,
} from "./ChatArtifactCard";

export interface ChatMessageViewProps {
  message: UIMessage;
  streaming: boolean;
  documents: Map<string, ConversationDocument>;
  onOpenArtifact: (documentId: string) => void;
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
}

export function ChatMessageView({
  message,
  streaming,
  documents,
  onOpenArtifact,
  onAnswerClientTool,
}: ChatMessageViewProps) {
  const reasoning = mergeReasoningParts(message.parts, {
    isMessageStreaming: streaming,
  });
  const visibleParts = withoutReasoningParts(message.parts);

  return (
    <AiMessage from={message.role}>
      <MessageContent>
        <div className="mb-1 text-xs opacity-70">
          {message.role === "user" ? "你" : "助手"}
        </div>
        <div className="space-y-3">
          {reasoning ? (
            <Reasoning isStreaming={reasoning.isStreaming}>
              <ReasoningTrigger />
              <ReasoningContent>{reasoning.text}</ReasoningContent>
            </Reasoning>
          ) : null}
          {visibleParts.map(({ part, index }) => (
            <MessagePartView
              key={partKey(message.id, part, index)}
              part={part}
              streaming={streaming}
              documents={documents}
              onOpenArtifact={onOpenArtifact}
              onAnswerClientTool={onAnswerClientTool}
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
  streaming,
  documents,
  onOpenArtifact,
  onAnswerClientTool,
}: {
  part: UIMessage["parts"][number];
  streaming: boolean;
  documents: Map<string, ConversationDocument>;
  onOpenArtifact: (documentId: string) => void;
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
}) {
  if (part.type === "text") {
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

  if (part.type === "data-artifact") {
    const streaming = parseArtifactStreamData(
      "data" in part ? part.data : undefined,
    );
    if (streaming && streaming.status !== "persisted") {
      return (
        <StreamingArtifactCard
          artifact={{
            documentId: streaming.document_id ?? "",
            status: streaming.status,
            title: streaming.title,
            filename: streaming.filename,
            kind: streaming.kind,
            content: streaming.preview,
            totalChars: streaming.generated_chars,
          }}
        />
      );
    }
    return null;
  }

  if (isToolUIPart(part)) {
    return (
      <ToolPartView
        part={part}
        documents={documents}
        onOpenArtifact={onOpenArtifact}
        onAnswerClientTool={onAnswerClientTool}
      />
    );
  }

  if (part.type === "step-start") {
    return (
      <Badge variant="outline" className="w-fit text-[10px]">
        step
      </Badge>
    );
  }

  return null;
}

function ToolPartView({
  part,
  documents,
  onOpenArtifact,
  onAnswerClientTool,
}: {
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>;
  documents: Map<string, ConversationDocument>;
  onOpenArtifact: (documentId: string) => void;
  onAnswerClientTool: (
    toolName: string,
    toolCallId: string,
    output: unknown,
  ) => void;
}) {
  const toolName = getToolName(part);
  const input = "input" in part ? part.input : undefined;
  const output = "output" in part ? part.output : undefined;
  const artifact = parseArtifactOutput(output);
  const askUserInput =
    toolName === "ask_user" ? parseAskUserInput(input) : null;
  const rememberInput = toolName === "remember" ? parseRememberInput(input) : null;

  if (artifact?.documentId) {
    return (
      <ArtifactDocumentCard
        document={documents.get(artifact.documentId)}
        documentId={artifact.documentId}
        fallback={artifact}
        onOpen={() => onOpenArtifact(artifact.documentId)}
      />
    );
  }

  if (artifact) {
    return <StreamingArtifactCard artifact={artifact} />;
  }

  return (
    <Tool open={part.state !== "output-available"}>
      <ToolHeader title={toolName} state={part.state} />
      <ToolContent>
        {part.state === "input-available" && (askUserInput || rememberInput) ? (
          <AskUserToolCard
            input={askUserInput ?? rememberInput!}
            onSubmit={(answer) =>
              onAnswerClientTool(toolName, part.toolCallId, answer)
            }
          />
        ) : null}
        {askUserInput == null && rememberInput == null && input !== undefined ? (
          <ToolJsonBlock value={input} />
        ) : null}
        {askUserInput == null && rememberInput == null && output !== undefined ? (
          <ToolJsonBlock value={output} />
        ) : null}
      </ToolContent>
    </Tool>
  );
}

function parseRememberInput(input: unknown): AskUserInput | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as { content?: unknown; reason?: unknown };
  if (typeof raw.content !== "string" || !raw.content.trim()) return null;
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  return {
    question: `是否记住：${raw.content.trim()}${reason ? `\n\n用途：${reason}` : ""}`,
    choices: [
      { label: "记住", value: "approve" },
      { label: "不用", value: "decline" },
    ],
    mode: "single",
    allowFreeform: false,
    freeformLabel: "",
  };
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
