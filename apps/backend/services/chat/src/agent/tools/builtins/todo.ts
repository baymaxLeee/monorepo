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
  return { ok: true, todos: input.todos };
}

export function createTodoTools() {
  return {
    update_todos: tool({
      description:
        "Create or replace the current todo list for this task. Always pass the full list. " +
        "Mark an item in_progress when you start it and completed as soon as it finishes. " +
        "When you dispatch several independent deliverables concurrently in one step, mark ALL of " +
        "them in_progress together (multiple in_progress is allowed), and set each deliverable tool " +
        "call's `todo_id` to the id of the todo item it fulfills so the UI can flip that item to done " +
        "the moment its task completes. Use it for multi-step tasks so progress stays visible; skip it " +
        "for simple one-step requests.",
      inputSchema: updateTodosInputSchema,
      execute: updateTodos,
    }),
  };
}
