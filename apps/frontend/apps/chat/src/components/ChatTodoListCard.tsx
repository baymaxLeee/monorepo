import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  Plan,
  PlanContent,
  PlanHeader,
  Task,
  TaskTitle,
} from "components/ai-chat";

export type TodoStatus = "pending" | "in_progress" | "completed";

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

export type TodoTaskStatus = "running" | "completed" | "failed";

type EffectiveStatus = "pending" | "running" | "completed" | "failed";

const DELIVERABLE_TOOL_NAMES = new Set([
  "generate_image",
  "generate_video",
  "write_file",
  "edit_file",
]);

export function collectTodoTaskStatus(
  messages: UIMessage[],
): Map<string, TodoTaskStatus> {
  const map = new Map<string, TodoTaskStatus>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      if (!DELIVERABLE_TOOL_NAMES.has(getToolName(part))) continue;
      const output =
        "output" in part && part.output && typeof part.output === "object"
          ? (part.output as Record<string, unknown>)
          : null;
      const todoId =
        output && typeof output.todo_id === "string" ? output.todo_id : null;
      if (!todoId) continue;
      let status: TodoTaskStatus = "running";
      if (part.state === "output-error" || output?.ok === false) {
        status = "failed";
      } else if (
        output?.status === "completed" ||
        output?.status === "persisted"
      ) {
        status = "completed";
      }
      map.set(todoId, status);
    }
  }
  return map;
}

function effectiveStatus(
  modelStatus: TodoStatus,
  taskStatus: TodoTaskStatus | undefined,
): EffectiveStatus {
  if (taskStatus === "completed" || taskStatus === "failed") return taskStatus;
  if (modelStatus === "completed") return "completed";
  if (taskStatus === "running" || modelStatus === "in_progress")
    return "running";
  return "pending";
}

export function parseTodoListOutput(
  output: unknown,
): { todos: TodoItem[] } | null {
  if (!output || typeof output !== "object") return null;
  const raw = output as Record<string, unknown>;
  if (!Array.isArray(raw.todos)) return null;
  const todos = raw.todos.filter(
    (item): item is TodoItem =>
      !!item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).id === "string" &&
      typeof (item as Record<string, unknown>).content === "string" &&
      typeof (item as Record<string, unknown>).status === "string",
  );
  return { todos };
}

export function findLatestUpdateTodosCallId(
  messages: UIMessage[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts;
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j];
      if (isToolUIPart(part) && getToolName(part) === "update_todos") {
        return part.toolCallId;
      }
    }
  }
  return null;
}

export function ChatTodoListCard({
  todos,
  taskStatus,
}: {
  todos: TodoItem[];
  taskStatus?: Map<string, TodoTaskStatus>;
}) {
  const items = todos.map((item) => ({
    ...item,
    effective: effectiveStatus(item.status, taskStatus?.get(item.id)),
  }));
  const done = items.filter((item) => item.effective === "completed").length;
  return (
    <Plan>
      <PlanHeader title={`任务清单 · ${done}/${items.length}`} />
      <PlanContent>
        {items.map((item) => (
          <Task key={item.id} status={item.effective}>
            <TaskTitle>{item.content}</TaskTitle>
          </Task>
        ))}
      </PlanContent>
    </Plan>
  );
}
