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

function parseSubagents(value: Record<string, unknown>) {
  if (!Array.isArray(value.subagents)) return [];
  return value.subagents.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.task !== "string") return [];
    const status: "completed" | "failed" | "running" =
      row.status === "completed" || row.status === "failed" ? row.status : "running";
    const error =
      row.error && typeof row.error === "object" && typeof (row.error as Record<string, unknown>).message === "string"
        ? ((row.error as Record<string, unknown>).message as string)
        : undefined;
    return [
      {
        id: row.id,
        task: row.task,
        status,
        message: parseMessage(row.message),
        report: typeof row.report === "string" ? row.report : undefined,
        steps: typeof row.steps === "number" ? row.steps : undefined,
        error,
      },
    ];
  });
}

export function ChatSubagents({ output, errorText }: { output: unknown; errorText?: string }) {
  const outcome = parseToolOutcome(output);
  const payload = outcome ? toolOutcomePayload(outcome) : undefined;
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const model = typeof value.model === "string" ? value.model : undefined;
  const subagents = parseSubagents(value);
  const batchFailure = errorText || (outcome?.ok === false ? outcome.error.message : undefined);

  if (batchFailure || subagents.length === 0) {
    return (
      <Subagent defaultOpen>
        <SubagentHeader
          name={`Subagents · ${batchFailure ? "失败" : "运行中"}`}
          model={model}
          status={batchFailure ? "failed" : "running"}
        />
        {batchFailure ? (
          <p role="alert" className="px-3 py-2 text-sm text-destructive">
            {batchFailure}
          </p>
        ) : null}
        <SubagentContent>
          <p className="text-xs text-muted-foreground">
            {batchFailure ? "错误已保留；不会自动重试。" : "正在拆分并启动独立的调研、检索与深度分析任务。"}
          </p>
        </SubagentContent>
      </Subagent>
    );
  }

  return (
    <div className="space-y-2">
      {subagents.map((subagent) => {
        const report = subagent.report ?? latestText(subagent.message);
        const nestedTools = subagent.message?.parts.filter(isToolUIPart) ?? [];
        return (
          <Subagent key={subagent.id} defaultOpen>
            <SubagentHeader
              name={`Subagent · ${subagent.id} · ${subagent.status === "completed" ? "已完成" : subagent.status === "failed" ? "失败" : "运行中"}${subagent.steps === undefined ? "" : ` · ${subagent.steps} 步`}`}
              model={model}
              status={subagent.status}
            />
            <SubagentContent>
              <p className="text-xs text-muted-foreground">{subagent.task}</p>
              {subagent.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {subagent.error}
                </p>
              ) : null}
              {nestedTools.map((part) => {
                const toolName = getToolName(part);
                return (
                  <Task key={part.toolCallId} status={nestedStatus(part)}>
                    <TaskTitle>{TOOL_LABELS[toolName] ?? toolName}</TaskTitle>
                  </Task>
                );
              })}
              {report ? <SubagentOutput>{report}</SubagentOutput> : null}
            </SubagentContent>
          </Subagent>
        );
      })}
    </div>
  );
}
