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

export function ChatTodoListCard({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter((item) => item.status === "completed").length;
  return (
    <Plan>
      <PlanHeader title={`任务清单 · ${done}/${todos.length}`} />
      <PlanContent>
        {todos.map((item) => (
          <Task
            key={item.id}
            status={item.status === "in_progress" ? "running" : item.status}
          >
            <TaskTitle>{item.content}</TaskTitle>
          </Task>
        ))}
      </PlanContent>
    </Plan>
  );
}
