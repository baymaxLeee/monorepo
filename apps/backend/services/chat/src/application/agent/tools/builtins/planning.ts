import { tool } from "ai";
import { z } from "zod";

import { defineAgentTool } from "../manifest.js";

const todoItemSchema = z.object({
  id: z.string().min(1).max(64).describe("Stable unique id for this task."),
  content: z.string().min(1).max(200).describe("Concrete user-visible task description."),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).describe("Current task state."),
  deliverable: z
    .enum(["artifact", "image", "video"])
    .optional()
    .describe("Tag only a task completed by one matching deliverable tool call."),
});

export const updateTodosInputSchema = z
  .object({
    todos: z.array(todoItemSchema).max(50).describe("The complete replacement snapshot, not a partial patch."),
  })
  .superRefine((input, context) => {
    const ids = new Set<string>();
    for (const [index, item] of input.todos.entries()) {
      if (ids.has(item.id)) {
        context.addIssue({ code: "custom", path: ["todos", index, "id"], message: `duplicate todo id: ${item.id}` });
      }
      ids.add(item.id);
    }
  });

const updateTodosOutputSchema = z.object({ todos: z.array(todoItemSchema) });

export type UpdateTodosOutput = z.infer<typeof updateTodosOutputSchema>;

function updateTodos(input: z.infer<typeof updateTodosInputSchema>): UpdateTodosOutput {
  return { todos: input.todos };
}

export function createPlanningToolManifests() {
  return [
    defineAgentTool(
      "update_todos",
      tool({
        description:
          "Create or replace the full todo list for a multi-step task. Prefer this as the first normal-mode action when executing an approved or referenced plan that has multiple checklist items, parallel deliverables, or real dependencies. Never call it for a single deliverable, a single actionable item, or a one-item list — multi-page HTML and other long single artifacts still skip todos and go straight to the generation tool. Duration alone is not a reason. Reflect real parallel work with multiple in-progress items. Use exactly ONE todo per deliverable and tag it with `deliverable` ('artifact' for write_file/edit_file/delegate_tasks, 'image' for generate_images, 'video' for create_video_production); the whole image batch (a single generate_images call with multiple prompts) is ONE 'image' todo, never one per image. A video todo must describe creating a video production task, never generating or completing the final video; it completes when create_video_production returns the production task id. Call this alone to lay out the complete list before you dispatch any deliverable.",
        inputSchema: updateTodosInputSchema,
        inputExamples: [
          {
            input: {
              todos: [
                { id: "research", content: "Collect current evidence", status: "in_progress" },
                { id: "report", content: "Create the HTML report", status: "pending", deliverable: "artifact" },
              ],
            },
          },
        ],
        outputSchema: updateTodosOutputSchema,
        execute: updateTodos,
      }),
      {
        capability: "planning",
        effect: "none",
        trust: "closed",
        execution: "inline",
        modes: ["normal"],
        uiKind: "todo-list",
      },
      { summary: "Maintain the current task's visible todo snapshot." },
    ),
  ];
}
