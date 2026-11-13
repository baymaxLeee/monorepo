import { finalizeInterruptedParts, hasNonTerminalOutput } from "@backend/agent-runtime-ts/lifecycle";
import { isToolOutcome, toolOutcomeData } from "@backend/agent-runtime-ts/outcome";
import { getToolName, isToolUIPart, type UIMessage } from "ai";

type AnyUIMessage = UIMessage<unknown, any, any>;

export function cancelTodoOutput(output: unknown): unknown {
  if (!isToolOutcome(output) || output.status !== "completed") {
    return output;
  }
  const data = toolOutcomeData(output);
  if (!data || typeof data !== "object") {
    return output;
  }
  const row = data as Record<string, unknown>;
  if (!Array.isArray(row.todos)) {
    return output;
  }
  return {
    ...output,
    data: {
      ...row,
      todos: row.todos.map((item) => {
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
    if (getToolName(part) === "update_todos" && "output" in part) {
      next = { ...next, output: cancelTodoOutput(part.output) };
    }

    return next as AnyUIMessage["parts"][number];
  });
  return finalizeInterruptedParts(domainFinalized, "已取消。");
}

export { hasNonTerminalOutput };
