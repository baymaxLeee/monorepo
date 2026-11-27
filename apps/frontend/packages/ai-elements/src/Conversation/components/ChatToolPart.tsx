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
import { getToolName, type UIMessage } from "ai";
import type { ReactNode } from "react";

import { parseAskUserInput } from "../lib/ask-user";
import { isClientTool, toolUiKind } from "../lib/conversation-messages";
import { parseToolOutcome } from "../lib/tool-outcome";
import { AskUserAnsweredCard } from "./AskUserAnsweredCard";
import { AskUserToolCard } from "./AskUserToolCard";
import { ChatImageCard } from "./ChatImageCard";
import { ChatSubagents } from "./ChatSubagents";
import { ChatTerminalTool } from "./ChatTerminalTool";
import { ChatVideoCard } from "./ChatVideoCard";
import { MCPAppView, readMCPAppView } from "./MCPAppView";
import { useToolDisclosure } from "./useToolDisclosure";

export function ChatToolPart({
  part,
  onOpenFile,
  onAnswerClientTool,
  onToolApproval,
}: {
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>;
  onOpenFile?: (fileId: string) => void;
  onAnswerClientTool?: (toolName: string, toolCallId: string, output: unknown) => void;
  onToolApproval?: (approvalId: string, approved: boolean) => void;
}) {
  const toolName = getToolName(part);
  const kind = toolUiKind(part);
  const input = "input" in part ? part.input : undefined;
  const rawInput = "rawInput" in part ? compactRawInput(part.rawInput) : undefined;
  const output = "output" in part ? part.output : undefined;
  const errorText = "errorText" in part && typeof part.errorText === "string" ? part.errorText : undefined;

  if (part.state === "approval-requested") {
    return (
      <ChatToolDisclosure part={part}>
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
          ) : !onToolApproval ? (
            <div className="text-xs text-muted-foreground">当前客户端不能处理此工具授权。</div>
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
      </ChatToolDisclosure>
    );
  }

  if (part.state === "approval-responded" || part.state === "output-denied") {
    return (
      <ChatToolDisclosure part={part}>
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
              <ConfirmationTitle>
                {part.approval?.isAutomatic ? "工具调用被自动拒绝。" : "工具调用已被拒绝。"}
              </ConfirmationTitle>
              {part.approval?.reason && <p className="text-sm text-muted-foreground">{part.approval.reason}</p>}
            </ConfirmationRejected>
          </Confirmation>
        </ToolContent>
      </ChatToolDisclosure>
    );
  }

  if (kind === "image-gallery" && onOpenFile) {
    return <ChatImageCard output={output} state={part.state} errorText={errorText} onOpen={onOpenFile} />;
  }

  if (kind === "video" && onOpenFile) {
    return <ChatVideoCard output={output} state={part.state} errorText={errorText} onOpen={onOpenFile} />;
  }

  if (kind === "terminal") {
    return <ChatTerminalTool input={input} output={output} errorText={errorText} running={!toolSettled(part)} />;
  }

  if (kind === "subagent") {
    return <ChatSubagents output={output} errorText={errorText} />;
  }

  const app = readMCPAppView(part);
  const outputErrorReason = parseToolOutputError(output);
  const askUserInput =
    kind === "ask-user" && toolName === "ask_user" && !part.providerExecuted && isClientTool(part)
      ? parseAskUserInput(input)
      : null;
  const hasError = part.state === "output-error" || outputErrorReason != null;
  return (
    <>
      {app && <MCPAppView key={part.toolCallId} view={app} />}
      <ChatToolDisclosure part={part}>
        <ToolHeader
          title={part.title}
          preliminary={!hasError && part.state === "output-available" && part.preliminary}
          type={part.type}
          toolName={part.type === "dynamic-tool" ? toolName : undefined}
          state={hasError ? "output-error" : part.state}
        />
        <ToolContent>
          {kind === "agent-ui" && part.state === "input-available" && (
            <p className="text-sm text-muted-foreground">
              等待发起操作的页面回传结果。若已刷新，请核对页面状态后停止本轮。
            </p>
          )}
          {part.state === "input-available" && askUserInput && onAnswerClientTool ? (
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
          {kind === "ask-user" ? null : (
            <>
              {askUserInput == null && input !== undefined ? <ToolJsonBlock value={input} /> : null}
              {askUserInput == null && input === undefined && rawInput !== undefined ? (
                <ToolJsonBlock value={{ rawInput }} />
              ) : null}
              {askUserInput == null && output !== undefined ? (
                <ToolJsonBlock value={app ? app.resultFields : output} />
              ) : null}
            </>
          )}
        </ToolContent>
      </ChatToolDisclosure>
    </>
  );
}

type ChatToolPartValue = Extract<UIMessage["parts"][number], { toolCallId: string }>;

function ChatToolDisclosure({ part, children }: { part: ChatToolPartValue; children: ReactNode }) {
  const disclosure = useToolDisclosure(toolSettled(part));
  return <Tool {...disclosure}>{children}</Tool>;
}

function toolSettled(part: ChatToolPartValue) {
  return (
    part.state === "output-error" ||
    part.state === "output-denied" ||
    (part.state === "output-available" && !part.preliminary)
  );
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
