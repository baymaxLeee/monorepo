import { Subagent, SubagentContent, SubagentHeader, SubagentOutput, Task, TaskTitle } from "@repo/ai-elements";
import { getToolName, isToolUIPart, type UIMessage } from "ai";

import { parseToolOutcome, toolOutcomePayload } from "../lib/tool-outcome";

const TOOL_LABELS: Record<string, string> = {
  web_search: "检索公开来源",
  web_fetch: "阅读来源正文",
};

function parseMessage(value: unknown): UIMessage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.role !== "assistant" || !Array.isArray(row.parts)) return null;
  return row as unknown as UIMessage;
}

function nestedStatus(part: Extract<UIMessage["parts"][number], { toolCallId: string }>) {
  if (part.state === "output-error" || part.state === "output-denied") return "failed" as const;
  if (part.state === "output-available" && !part.preliminary) return "completed" as const;
  return "running" as const;
}

function latestText(message: UIMessage | null): string | null {
  if (!message) return null;
  for (let index = message.parts.length - 1; index >= 0; index--) {
    const part = message.parts[index];
    if (part.type === "text" && part.text.trim()) return part.text.trim();
  }
  return null;
}

export function ChatResearchSubagent({ output, errorText }: { output: unknown; errorText?: string }) {
  const outcome = parseToolOutcome(output);
  const payload = outcome ? toolOutcomePayload(outcome) : undefined;
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const message = parseMessage(value.message);
  const report = typeof value.report === "string" ? value.report : latestText(message);
  const model = typeof value.model === "string" ? value.model : undefined;
  const steps = typeof value.steps === "number" ? value.steps : undefined;
  const failure = errorText || (outcome?.ok === false ? outcome.error.message : undefined);
  const status = failure ? "failed" : outcome?.status === "completed" ? "completed" : "running";
  const nestedTools = message?.parts.filter(isToolUIPart) ?? [];

  return (
    <Subagent defaultOpen>
      <SubagentHeader
        name={`深度研究 · ${failure ? "失败" : status === "completed" ? "已完成" : "运行中"}${steps === undefined ? "" : ` · ${steps} 步`}`}
        model={model}
        status={status}
      />
      {failure ? (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {failure}
        </p>
      ) : null}
      <SubagentContent>
        {nestedTools.map((part) => {
          const toolName = getToolName(part);
          return (
            <Task key={part.toolCallId} status={nestedStatus(part)}>
              <TaskTitle>{TOOL_LABELS[toolName] ?? toolName}</TaskTitle>
            </Task>
          );
        })}
        {report ? (
          <SubagentOutput>{report}</SubagentOutput>
        ) : (
          <p className="text-xs text-muted-foreground">
            {failure ? "错误已保留；不会自动重试。" : "正在独立上下文中检索、核对来源并压缩研究结果。"}
          </p>
        )}
      </SubagentContent>
    </Subagent>
  );
}
