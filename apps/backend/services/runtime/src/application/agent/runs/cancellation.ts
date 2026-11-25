import { finalizeInterruptedParts, hasNonTerminalOutput, isToolOutcome, toolOutcomeData } from "@repo/agent-runtime";
import { getToolName, isToolUIPart, type UIMessage } from "ai";

type AnyUIMessage = UIMessage<unknown, any, any>;
export type TerminalRunStatus = "failed" | "cancelled" | "interrupted";

export function terminalRunErrorText(status: TerminalRunStatus): string {
  if (status === "cancelled") return "已取消。";
  if (status === "interrupted") return "执行已中断，工具未返回结果。";
  return "执行失败，工具未返回结果。";
}

export function cancelPlanOutput(output: unknown): unknown {
  if (!isToolOutcome(output) || output.status !== "completed") {
    return output;
  }
  const data = toolOutcomeData(output);
  if (!data || typeof data !== "object") {
    return output;
  }
  const row = data as Record<string, unknown>;
  if (!Array.isArray(row.plan)) {
    return output;
  }
  return {
    ...output,
    data: {
      ...row,
      plan: row.plan.map((item) => {
        if (!item || typeof item !== "object") {
          return item;
        }
        const todo = item as Record<string, unknown>;
        return todo.status === "completed" ? todo : { ...todo, status: "cancelled" };
      }),
    },
  };
}

export function finalizeTerminalParts(parts: AnyUIMessage["parts"], status: TerminalRunStatus): AnyUIMessage["parts"] {
  const domainFinalized =
    status === "cancelled"
      ? parts.map((part) => {
          if (!isToolUIPart(part)) {
            return part;
          }

          let next = part as unknown as Record<string, unknown>;
          if (getToolName(part) === "update_plan" && "output" in part) {
            next = { ...next, output: cancelPlanOutput(part.output) };
          }

          return next as AnyUIMessage["parts"][number];
        })
      : parts;
  return finalizeInterruptedParts(domainFinalized, terminalRunErrorText(status));
}

export function finalizeCancelledParts(parts: AnyUIMessage["parts"]): AnyUIMessage["parts"] {
  return finalizeTerminalParts(parts, "cancelled");
}

export { hasNonTerminalOutput };
