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

// Live status of the durable task a todo item is linked to (via todo_id echoed
// by the deliverable tools). "running" while its task is in flight, terminal
// otherwise. This is the frontend join that lets the todo list advance
// 1/3 -> 2/3 -> 3/3 live during a concurrent, foreground-blocking step, before
// the model regains control to reconcile the canonical list (ADR-0017 / 0022).
export type TodoTaskStatus = "running" | "completed" | "failed";

// A visual status the Task primitive understands. A subset of WorkflowStatus.
type EffectiveStatus = "pending" | "running" | "completed" | "failed";

const DELIVERABLE_TOOL_NAMES = new Set([
  "generate_image",
  "generate_video",
  "write_file",
  "edit_file",
]);

// Scan the whole transcript for deliverable tool parts that carry a todo_id and
// map each to its live status. A deliverable's own generator yields its terminal
// result the moment THAT task finishes (streamed as a preliminary tool output),
// so this reflects per-task completion even while sibling tasks are still
// running inside the same blocking step. Later parts overwrite earlier ones, so
// a todo_id reused across executions resolves to its most recent task.
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

// Combine the model's canonical status with the linked task's live status,
// preferring whichever is "more done": a finished task shows completed/failed
// even before the model reconciles, and an unfinished linked task shows a
// running spinner even while the model still lists it pending.
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
