import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
  Tool,
  ToolContent,
  ToolHeader,
  ToolJsonBlock,
} from "@repo/ai-elements";
import type { ConversationDocument } from "@repo/api";
import { getToolName, type UIMessage } from "ai";

import { parseAskUserInput } from "../lib/ask-user";
import { isClientTool } from "../lib/conversation-messages";
import { parseToolOutcome } from "../lib/tool-outcome";
import { AskUserAnsweredCard } from "./AskUserAnsweredCard";
import { AskUserToolCard } from "./AskUserToolCard";
import { ArtifactDocumentCard, parseArtifactOutput } from "./ChatArtifactCard";
import { ArtifactFileCard } from "./ChatFileArtifactCard";
import { ChatImageCard } from "./ChatImageCard";
import { ChatResearchSubagent } from "./ChatResearchSubagent";
import { ChatTerminalTool } from "./ChatTerminalTool";
import {
  ChatTodoListCard,
  type DeliverableCompletion,
  isTodoListSettled,
  parseTodoListOutput,
} from "./ChatTodoListCard";
import { ChatVideoCard } from "./ChatVideoCard";

export function ChatToolPart({
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
  onOpenFile: (fileId: string) => void;
  onAnswerClientTool: (toolName: string, toolCallId: string, output: unknown) => void;
  onToolApproval: (approvalId: string, approved: boolean) => void;
  onExecutePlan: (documentId: string) => void;
  planExecutedIds: ReadonlySet<string>;
  planBusy: boolean;
}) {
  const toolName = getToolName(part);
  const kind = toolUiKind(part);
  if (toolIsInternal(part)) {
    return null;
  }
  if (kind === "todo-list" && part.toolCallId !== latestTodoCallId) {
    return null;
  }
  const input = "input" in part ? part.input : undefined;
  const rawInput = "rawInput" in part ? compactRawInput(part.rawInput) : undefined;
  const output = "output" in part ? part.output : undefined;
  const errorText = "errorText" in part && typeof part.errorText === "string" ? part.errorText : undefined;

  if (part.state === "approval-requested") {
    return (
      <Tool defaultOpen>
        <ToolHeader
          type={part.type}
          title={part.title}
          toolName={part.type === "dynamic-tool" ? toolName : undefined}
          state={part.state}
        />
        <ToolContent>
          <ToolJsonBlock value={input} />
          {part.approval.isAutomatic ? (
            <div className="text-xs text-muted-foreground">正在检查工具授权策略…</div>
          ) : (
            <Confirmation approval={part.approval} state={part.state}>
              <ConfirmationRequest>
                <ConfirmationTitle>此工具需要你的授权后才能继续执行。</ConfirmationTitle>
                {part.approval.requestReason && (
                  <p className="text-sm text-muted-foreground">{part.approval.requestReason}</p>
                )}
                <ConfirmationActions>
                  <ConfirmationAction variant="outline" onClick={() => onToolApproval(part.approval.id, false)}>
                    拒绝
                  </ConfirmationAction>
                  <ConfirmationAction onClick={() => onToolApproval(part.approval.id, true)}>允许</ConfirmationAction>
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
      <Tool defaultOpen={part.state === "output-denied"}>
        <ToolHeader
          type={part.type}
          title={part.title}
          toolName={part.type === "dynamic-tool" ? toolName : undefined}
          state={part.state}
        />
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
    return <ChatImageCard conversationId={conversationId} output={output} state={part.state} errorText={errorText} />;
  }

  if (
    kind === "video" &&
    part.toolMetadata?.agent &&
    typeof part.toolMetadata.agent === "object" &&
    "historical" in part.toolMetadata.agent &&
    part.toolMetadata.agent.historical
  ) {
    return (
      <Tool>
        <ToolHeader
          type={part.type}
          toolName={part.type === "dynamic-tool" ? toolName : undefined}
          state={part.state}
          preliminary={part.state === "output-available" && part.preliminary}
          title="原会话的视频任务"
        />
        <ToolContent>
          <p className="text-sm text-muted-foreground">这是历史任务记录。审批和发布请返回原会话操作。</p>
          <ToolJsonBlock value={output} />
        </ToolContent>
      </Tool>
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

  if (kind === "terminal") {
    return (
      <ChatTerminalTool
        input={input}
        output={output}
        errorText={errorText}
        running={part.state === "input-streaming" || part.state === "input-available"}
      />
    );
  }

  if (kind === "subagent") {
    return <ChatResearchSubagent output={output} errorText={errorText} />;
  }

  const outputErrorReason = parseToolOutputError(output);
  const artifact = kind === "artifact" ? parseArtifactOutput(output) : null;
  const askUserInput =
    kind === "ask-user" && toolName === "ask_user" && !part.providerExecuted && isClientTool(part)
      ? parseAskUserInput(input)
      : null;
  const todoList = kind === "todo-list" ? parseTodoListOutput(output) : null;

  if (artifact?.documentId) {
    const documentId = artifact.documentId;
    return (
      <ArtifactDocumentCard
        document={documents.get(documentId)}
        documentId={documentId}
        fallback={artifact}
        onOpen={() => onOpenArtifact(documentId)}
      />
    );
  }

  if (artifact?.fileId) {
    const fileId = artifact.fileId;
    return (
      <ArtifactFileCard
        artifact={{ ...artifact, fileId }}
        planExecuted={planExecutedIds.has(fileId)}
        planBusy={planBusy}
        onOpen={() => onOpenFile(fileId)}
        onExecutePlan={() => onExecutePlan(fileId)}
      />
    );
  }

  const hasError = part.state === "output-error" || outputErrorReason != null;
  const todoSettled = todoList != null && isTodoListSettled(todoList.todos, deliverableCompletion);
  const isOpenByDefault =
    todoList != null ? !todoSettled : (askUserInput != null && part.state === "input-available") || hasError;

  return (
    <Tool defaultOpen={isOpenByDefault}>
      <ToolHeader
        title={part.title}
        preliminary={!hasError && part.state === "output-available" && part.preliminary}
        type={part.type}
        toolName={part.type === "dynamic-tool" ? toolName : undefined}
        state={hasError ? "output-error" : part.state}
      />
      <ToolContent>
        {part.state === "input-available" && askUserInput ? (
          <AskUserToolCard
            input={askUserInput}
            onSubmit={(answer) => onAnswerClientTool(toolName, part.toolCallId, answer)}
          />
        ) : null}
        {kind === "ask-user" && part.state === "output-available" && askUserInput ? (
          <AskUserAnsweredCard input={askUserInput} output={output} />
        ) : null}
        {hasError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
            {errorText?.trim() || outputErrorReason || "工具调用失败，未返回错误详情。"}
          </div>
        ) : null}
        {todoList ? (
          <ChatTodoListCard todos={todoList.todos} deliverableCompletion={deliverableCompletion} />
        ) : kind === "ask-user" ? null : (
          <>
            {askUserInput == null && input !== undefined ? <ToolJsonBlock value={input} /> : null}
            {askUserInput == null && input === undefined && rawInput !== undefined ? (
              <ToolJsonBlock value={{ rawInput }} />
            ) : null}
            {askUserInput == null && output !== undefined ? <ToolJsonBlock value={output} /> : null}
          </>
        )}
      </ToolContent>
    </Tool>
  );
}

function toolUiKind(part: Extract<UIMessage["parts"][number], { toolCallId: string }>): string | null {
  if (!("toolMetadata" in part) || !part.toolMetadata) {
    return null;
  }
  const agent = part.toolMetadata.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    return null;
  }
  const value = agent as Record<string, unknown>;
  return typeof value.uiKind === "string" ? value.uiKind : null;
}

function toolIsInternal(part: Extract<UIMessage["parts"][number], { toolCallId: string }>): boolean {
  if (!("toolMetadata" in part) || !part.toolMetadata) {
    return false;
  }
  const agent = part.toolMetadata.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    return false;
  }
  return (agent as Record<string, unknown>).visibility === "internal";
}

function parseToolOutputError(output: unknown): string | null {
  const outcome = parseToolOutcome(output);
  return outcome && outcome.ok === false ? outcome.error.message : null;
}

function compactRawInput(rawInput: unknown) {
  if (typeof rawInput !== "string") {
    return rawInput;
  }
  const contentMatch = rawInput.match(/"content"\s*:\s*"([\s\S]*)/);
  if (!contentMatch?.[1]) {
    return rawInput;
  }
  return rawInput.replace(
    /"content"\s*:\s*"[\s\S]*/m,
    `"content":"[redacted malformed artifact content: ${contentMatch[1].length} chars]"`,
  );
}
