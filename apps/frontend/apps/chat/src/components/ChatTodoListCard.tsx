import { isToolUIPart, type UIMessage } from "ai";
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

function uiKind(
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>,
) {
  if (!("toolMetadata" in part) || !part.toolMetadata) return null;
  const agent = part.toolMetadata.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return null;
  return typeof agent.uiKind === "string" ? agent.uiKind : null;
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
      if (isToolUIPart(part) && uiKind(part) === "todo-list") {
        return part.toolCallId;
      }
    }
  }
  return null;
}

export function ChatTodoListCard({ todos }: { todos: TodoItem[] }) {
  const items = todos.map((item) => ({
    ...item,
    effective: (item.status === "in_progress" ? "running" : item.status) as
      | "pending"
      | "running"
      | "completed",
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
