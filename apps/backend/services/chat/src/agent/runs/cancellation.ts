import type { UIMessage } from "ai";

type AnyUIMessage = UIMessage<unknown, any, any>;

const NON_TERMINAL_OUTPUT_STATUSES = new Set([
  "generating",
  "pending",
  "queued",
  "running",
  "submitted",
]);

export function cancelTodoOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const row = output as Record<string, unknown>;
  if (!Array.isArray(row.todos)) return output;
  return {
    ...row,
    todos: row.todos.map((item) => {
      if (!item || typeof item !== "object") return item;
      const todo = item as Record<string, unknown>;
      return todo.status === "completed" ? todo : { ...todo, status: "cancelled" };
    }),
  };
}

export function finalizeCancelledParts(
  parts: AnyUIMessage["parts"],
): AnyUIMessage["parts"] {
  return parts.map((part) => {
    if (!part || typeof part !== "object" || !("toolCallId" in part)) return part;

    let next = part as unknown as Record<string, unknown>;
    if (part.type === "tool-update_todos" && "output" in part) {
      next = { ...next, output: cancelTodoOutput(part.output) };
    }

    if (next.state === "output-error" || next.state === "output-denied") {
      return next as AnyUIMessage["parts"][number];
    }
    if (
      next.state === "output-available" &&
      next.preliminary !== true &&
      !hasNonTerminalOutput(next.output)
    ) {
      return next as AnyUIMessage["parts"][number];
    }

    const { output: _output, preliminary: _preliminary, ...terminal } = next;
    return {
      ...terminal,
      state: "output-error",
      errorText: "已取消。",
    } as AnyUIMessage["parts"][number];
  }) as AnyUIMessage["parts"];
}

function hasNonTerminalOutput(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const status = (output as { status?: unknown }).status;
  return typeof status === "string" && NON_TERMINAL_OUTPUT_STATUSES.has(status);
}
