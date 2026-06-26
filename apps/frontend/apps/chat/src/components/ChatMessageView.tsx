import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { ConversationDocument } from "api";
import { Badge } from "components";
import {
  Message as AiMessage,
  MessageContent,
  MessageResponse,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Tool,
  ToolContent,
  ToolHeader,
  ToolJsonBlock,
} from "components/ai-chat";
import {
  ArtifactDocumentCard,
  parseArtifactOutput,
  StreamingArtifactCard,
} from "./ChatArtifactCard";

export interface ChatMessageViewProps {
  message: UIMessage;
  streaming: boolean;
  documents: Map<string, ConversationDocument>;
  onOpenArtifact: (documentId: string) => void;
}

export function ChatMessageView({
  message,
  streaming,
  documents,
  onOpenArtifact,
}: ChatMessageViewProps) {
  return (
    <AiMessage from={message.role}>
      <MessageContent>
        <div className="mb-1 text-xs opacity-70">
          {message.role === "user" ? "你" : "助手"}
        </div>
        <div className="space-y-3">
          {message.parts.map((part, index) => (
            <MessagePartView
              key={partKey(message.id, part, index)}
              part={part}
              streaming={streaming}
              documents={documents}
              onOpenArtifact={onOpenArtifact}
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
}: {
  part: UIMessage["parts"][number];
  streaming: boolean;
  documents: Map<string, ConversationDocument>;
  onOpenArtifact: (documentId: string) => void;
}) {
  if (part.type === "text") {
    return (
      <MessageResponse isAnimating={streaming}>{part.text}</MessageResponse>
    );
  }

  if (part.type === "reasoning") {
    return (
      <Reasoning isStreaming={streaming}>
        <ReasoningTrigger />
        <ReasoningContent>{part.text}</ReasoningContent>
      </Reasoning>
    );
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

  if (isToolUIPart(part)) {
    return (
      <ToolPartView
        part={part}
        documents={documents}
        onOpenArtifact={onOpenArtifact}
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
}: {
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>;
  documents: Map<string, ConversationDocument>;
  onOpenArtifact: (documentId: string) => void;
}) {
  const toolName = getToolName(part);
  const input = "input" in part ? part.input : undefined;
  const output = "output" in part ? part.output : undefined;
  const artifact = parseArtifactOutput(output);

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
        {input !== undefined ? <ToolJsonBlock value={input} /> : null}
        {output !== undefined ? <ToolJsonBlock value={output} /> : null}
      </ToolContent>
    </Tool>
  );
}
