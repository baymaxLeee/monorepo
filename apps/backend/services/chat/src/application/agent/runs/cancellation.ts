import { getToolName, isToolUIPart, type UIMessage } from "ai";

import { isToolOutcome, toolOutcomeData } from "../tools/outcome.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

const NON_TERMINAL_OUTPUT_STATUSES = new Set(["generating", "pending", "queued", "running", "submitted"]);

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
  return parts.map((part) => {
    if (!isToolUIPart(part)) {
      return part;
    }

    let next = part as unknown as Record<string, unknown>;
    if (getToolName(part) === "update_todos" && "output" in part) {
      next = { ...next, output: cancelTodoOutput(part.output) };
    }

    if (next.state === "output-error" || next.state === "output-denied") {
      return next as AnyUIMessage["parts"][number];
    }
    if (next.state === "output-available" && next.preliminary !== true && !hasNonTerminalOutput(next.output)) {
      return next as AnyUIMessage["parts"][number];
    }

    const { output: _output, preliminary: _preliminary, approval, ...terminal } = next;
    // output-error accepts only a granted approval in the native SDK schema.
    // A pending or denied request is not a granted execution after cancellation.
    const granted =
      approval && typeof approval === "object" && "approved" in approval && approval.approved === true
        ? approval
        : undefined;
    return {
      ...terminal,
      ...(granted ? { approval: granted } : {}),
      state: "output-error",
      errorText: "已取消。",
    } as AnyUIMessage["parts"][number];
  });
}

export function hasNonTerminalOutput(output: unknown): boolean {
  if (isToolOutcome(output)) {
    return output.status === "running";
  }
  if (!output || typeof output !== "object") {
    return false;
  }
  const status = (output as { status?: unknown }).status;
  return typeof status === "string" && NON_TERMINAL_OUTPUT_STATUSES.has(status);
}
