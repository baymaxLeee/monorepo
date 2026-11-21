import { finalizeInterruptedParts, hasNonTerminalOutput, isToolOutcome, toolOutcomeData } from "@repo/agent-runtime";
import { getToolName, isToolUIPart, type UIMessage } from "ai";

type AnyUIMessage = UIMessage<unknown, any, any>;

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

export function finalizeCancelledParts(parts: AnyUIMessage["parts"]): AnyUIMessage["parts"] {
  const domainFinalized = parts.map((part) => {
    if (!isToolUIPart(part)) {
      return part;
    }

    let next = part as unknown as Record<string, unknown>;
    if (getToolName(part) === "update_plan" && "output" in part) {
      next = { ...next, output: cancelPlanOutput(part.output) };
    }

    return next as AnyUIMessage["parts"][number];
  });
  return finalizeInterruptedParts(domainFinalized, "已取消。");
}

export { hasNonTerminalOutput };
