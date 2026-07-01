import { tool } from "ai";
import { z } from "zod";

const todoItemSchema = z.object({
  id: z.string().min(1).max(64),
  content: z.string().min(1).max(200),
  status: z.enum(["pending", "in_progress", "completed"]),
});

export const updateTodosInputSchema = z.object({
  todos: z.array(todoItemSchema).max(50),
});

export type UpdateTodosOutput =
  | { ok: true; todos: z.infer<typeof todoItemSchema>[] }
  | { ok: false; error: string };

function updateTodos(input: z.infer<typeof updateTodosInputSchema>): UpdateTodosOutput {
  const ids = new Set<string>();
  for (const item of input.todos) {
    if (ids.has(item.id)) {
      return { ok: false, error: `duplicate todo id: ${item.id}` };
    }
    ids.add(item.id);
  }
  const inProgress = input.todos.filter((item) => item.status === "in_progress");
  if (inProgress.length > 1) {
    return { ok: false, error: "at most one todo may be in_progress at a time" };
  }
  return { ok: true, todos: input.todos };
}

export function createTodoTools() {
  return {
    update_todos: tool({
      description:
        "Create or replace the current todo list for this task. Always pass the full list; " +
        "mark at most one item in_progress at a time and mark items completed as soon as they finish. " +
        "Use it for multi-step tasks so progress stays visible; skip it for simple one-step requests.",
      inputSchema: updateTodosInputSchema,
      execute: updateTodos,
    }),
  };
}
