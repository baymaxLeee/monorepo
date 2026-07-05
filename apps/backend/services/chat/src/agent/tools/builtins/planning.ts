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

const planArtifactOutputSchema = z.object({
  ok: z.literal(true),
  status: z.literal("persisted"),
  document_id: z.string(),
  revision_id: z.string(),
  title: z.string(),
  filename: z.string(),
  kind: z.literal("plan"),
});

const updatePlanOutputSchema = z.union([
  planArtifactOutputSchema,
  z.object({
    ok: z.literal(false),
    conflict: z.literal(true),
    error: z.string(),
    revision_id: z.string().optional(),
  }),
]);

const todoItemSchema = z.object({
  id: z.string().min(1).max(64),
  content: z.string().min(1).max(200),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  deliverable: z.enum(["artifact", "image", "video"]).optional(),
});

export const updateTodosInputSchema = z.object({
  todos: z.array(todoItemSchema).max(50),
});

const updateTodosOutputSchema = z.union([
  z.object({ ok: z.literal(true), todos: z.array(todoItemSchema) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export type UpdateTodosOutput = z.infer<typeof updateTodosOutputSchema>;

function updateTodos(input: z.infer<typeof updateTodosInputSchema>): UpdateTodosOutput {
  const ids = new Set<string>();
  for (const item of input.todos) {
    if (ids.has(item.id)) return { ok: false, error: `duplicate todo id: ${item.id}` };
    ids.add(item.id);
  }
  return { ok: true, todos: input.todos };
}

export function createPlanningToolManifests() {
  return [
    defineAgentTool(
      "write_plan",
      tool({
        description: "Create the active Markdown execution plan. The filename is normalized to *-plan.md.",
        inputSchema: writePlanInputSchema,
        outputSchema: planArtifactOutputSchema,
        contextSchema: planToolContextSchema,
        execute: writePlanTool,
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
        description: "Replace the active Markdown plan using its document id and latest revision id.",
        inputSchema: updatePlanInputSchema,
        outputSchema: updatePlanOutputSchema,
        contextSchema: planToolContextSchema,
        execute: updatePlanTool,
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
          "Create or replace the full todo list for a multi-step task. Reflect real parallel work with multiple in-progress items. Use exactly ONE todo per deliverable and tag it with `deliverable` ('artifact' for write_file/edit_file, 'image' for generate_images, 'video' for generate_video); the whole image batch (a single generate_images call with multiple prompts) is ONE 'image' todo, never one per image. Call this alone to lay out the complete list before you dispatch any deliverable — a tagged todo then advances to completed on its own the moment that deliverable's card finishes, independently of the slower siblings, so you need not wait for the whole parallel step to reconcile them.",
        inputSchema: updateTodosInputSchema,
        outputSchema: updateTodosOutputSchema,
        execute: updateTodos,
      }),
      {
        capability: "planning",
        effect: "none",
        trust: "closed",
        execution: "inline",
        modes: ["normal", "plan"],
        uiKind: "todo-list",
      },
      { summary: "Maintain the current task's visible todo snapshot." },
    ),
  ];
}
