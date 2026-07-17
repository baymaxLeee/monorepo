import { tool } from "ai";
import { z } from "zod";

import {
  updatePlanInputSchema,
  updatePlanTool,
  writePlanInputSchema,
  writePlanTool,
} from "../../plans/service.js";
import { planToolContextSchema } from "../context.js";
import { defineAgentTool } from "../manifest.js";
import { ToolBlockedError } from "../outcome.js";

const planArtifactOutputSchema = z.object({
  status: z.literal("persisted"),
  document_id: z.string(),
  revision_id: z.string(),
  title: z.string(),
  filename: z.string(),
  kind: z.literal("plan"),
  next_suggestion: z.string(),
});

const todoItemSchema = z.object({
  id: z.string().min(1).max(64),
  content: z.string().min(1).max(200),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  deliverable: z.enum(["artifact", "image", "video"]).optional(),
});

export const updateTodosInputSchema = z.object({
  todos: z.array(todoItemSchema).max(50),
}).superRefine((input, context) => {
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

function planArtifactData(output: Awaited<ReturnType<typeof writePlanTool>>) {
  const { ok: _ok, ...data } = output;
  return data;
}

export function createPlanningToolManifests() {
  return [
    defineAgentTool(
      "write_plan",
      tool({
        description:
          "Create the active Markdown execution plan. The filename is normalized to *-plan.md. The returned `next_suggestion` is advisory for a later normal-mode execution turn: for medium or difficult approved plans, consider update_todos first.",
        inputSchema: writePlanInputSchema,
        outputSchema: planArtifactOutputSchema,
        contextSchema: planToolContextSchema,
        execute: async (input, options) => planArtifactData(await writePlanTool(input, options)),
      }),
      {
        capability: "planning",
        effect: "add",
        trust: "closed",
        execution: "inline",
        modes: ["plan"],
        uiKind: "artifact",
      },
      { summary: "Create the active Markdown execution plan." },
    ),
    defineAgentTool(
      "update_plan",
      tool({
        description:
          "Replace the active Markdown plan using its document id and latest revision id. The returned `next_suggestion` is advisory for a later normal-mode execution turn: for medium or difficult approved plans, consider update_todos first.",
        inputSchema: updatePlanInputSchema,
        outputSchema: planArtifactOutputSchema,
        contextSchema: planToolContextSchema,
        execute: async (input, options) => {
          const output = await updatePlanTool(input, options);
          if (!output.ok) {
            throw new ToolBlockedError({
              code: "PLAN_REVISION_CONFLICT",
              message: output.error,
              retryable: false,
              source: "planning",
              ...(output.revision_id
                ? { details: { revision_id: output.revision_id } }
                : {}),
            });
          }
          return planArtifactData(output);
        },
      }),
      {
        capability: "planning",
        effect: "update",
        trust: "closed",
        execution: "inline",
        modes: ["plan"],
        uiKind: "artifact",
      },
      { summary: "Update the active plan with compare-and-swap revision control." },
    ),
    defineAgentTool(
      "update_todos",
      tool({
        description:
          "Create or replace the full todo list for a multi-step task. Prefer this as the first normal-mode action when executing an approved or referenced plan that has multiple checklist items, parallel deliverables, or real dependencies. Never call it for a single deliverable, a single actionable item, or a one-item list — multi-page HTML and other long single artifacts still skip todos and go straight to the generation tool. Duration alone is not a reason. Reflect real parallel work with multiple in-progress items. Use exactly ONE todo per deliverable and tag it with `deliverable` ('artifact' for write_file/edit_file, 'image' for generate_images, 'video' for generate_video); the whole image batch (a single generate_images call with multiple prompts) is ONE 'image' todo, never one per image. Call this alone to lay out the complete list before you dispatch any deliverable.",
        inputSchema: updateTodosInputSchema,
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
