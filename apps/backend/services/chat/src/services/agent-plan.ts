import { z } from "zod";
import type { ToolContext } from "./agent-types.js";

const planResultSchema = z.object({
  kind: z.enum(["artifact", "document", "file", "url", "tool", "other"]),
  id: z.string().max(160).optional(),
  label: z.string().max(200).optional(),
  url: z.string().url().max(2000).optional(),
});

const planErrorSchema = z.object({
  message: z.string().min(1).max(500),
  retryable: z.boolean().optional(),
});

export const planItemStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "skipped",
]);

export const planItemSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(80),
  title: z.string().min(1).max(240),
  status: planItemStatusSchema,
  description: z.string().max(1000).optional(),
  dependsOn: z.array(z.string().max(80)).max(20).optional(),
  result: planResultSchema.optional(),
  error: planErrorSchema.optional(),
});

export const planSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  planId: z.string().min(1).max(128),
  revision: z.number().int().positive(),
  goal: z.string().min(1).max(500),
  status: z.enum(["active", "completed", "abandoned"]),
  items: z.array(planItemSchema).min(1).max(100),
  explanation: z.string().max(500).optional(),
  updatedAt: z.string(),
});

export const updatePlanInputSchema = z.object({
  planId: z.string().min(1).max(128).optional(),
  baseRevision: z.number().int().nonnegative().optional(),
  goal: z.string().min(1).max(500),
  status: z.enum(["active", "completed", "abandoned"]),
  items: z.array(planItemSchema).min(1).max(100),
  explanation: z.string().max(500).optional(),
});

export type PlanSnapshot = z.infer<typeof planSnapshotSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanInputSchema>;

function assertPlan(input: UpdatePlanInput): void {
  const ids = new Set(input.items.map((item) => item.id));
  if (ids.size !== input.items.length) throw new Error("plan item ids must be unique");
  for (const item of input.items) {
    for (const dependency of item.dependsOn ?? []) {
      if (!ids.has(dependency)) throw new Error(`plan item ${item.id} depends on unknown item ${dependency}`);
      if (dependency === item.id) throw new Error(`plan item ${item.id} cannot depend on itself`);
    }
  }
  if (
    input.status === "completed" &&
    input.items.some((item) => !["completed", "skipped"].includes(item.status))
  ) {
    throw new Error("completed plan contains unfinished items");
  }
}

export async function updatePlanTool(
  input: UpdatePlanInput,
  { context, toolCallId }: { context: ToolContext; toolCallId: string },
): Promise<PlanSnapshot> {
  "use step";
  assertPlan(input);
  const { latestCompletedToolOutput } = await import("./agent-state.js");
  const current = parsePlanSnapshot(await latestCompletedToolOutput(context.conversationId, "update_plan"));
  if (input.planId && current?.planId === input.planId && input.baseRevision !== current.revision) {
    throw new Error(`plan revision conflict: expected ${current.revision}, received ${input.baseRevision ?? "none"}`);
  }
  return {
    schemaVersion: 1,
    planId: input.planId ?? toolCallId,
    revision: current && current.planId === input.planId ? current.revision + 1 : 1,
    goal: input.goal,
    status: input.status,
    items: input.items,
    explanation: input.explanation,
    updatedAt: new Date().toISOString(),
  };
}

export function parsePlanSnapshot(value: unknown): PlanSnapshot | null {
  const parsed = planSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function latestPlanFromParts(
  messages: Array<{ role: string; parts: Array<Record<string, unknown>> }>,
): PlanSnapshot | null {
  let latest: PlanSnapshot | null = null;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "tool-update_plan" || part.state !== "output-available") continue;
      const plan = parsePlanSnapshot(part.output);
      if (!plan) continue;
      if (!latest || plan.revision > latest.revision || plan.planId !== latest.planId) latest = plan;
    }
  }
  return latest?.status === "active" ? latest : null;
}

export function activePlanContext(plan: PlanSnapshot | null): string | null {
  if (!plan) return null;
  const items = plan.items.map((item) => {
    const dependencies = item.dependsOn?.length ? ` depends_on="${item.dependsOn.join(",")}"` : "";
    const result = item.result ? ` result="${item.result.kind}:${item.result.id ?? item.result.url ?? item.result.label ?? "available"}"` : "";
    return `<item id="${item.id}" status="${item.status}"${dependencies}${result}>${item.title}</item>`;
  });
  return [
    `<active_plan id="${plan.planId}" revision="${plan.revision}">`,
    `<goal>${plan.goal}</goal>`,
    "<items>",
    ...items,
    "</items>",
    "Continue this plan when the new request is related. Never repeat completed items. If the user starts a clearly unrelated goal, abandon this plan with update_plan before creating a new one.",
    "</active_plan>",
  ].join("\n");
}
