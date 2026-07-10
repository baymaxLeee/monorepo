import { z } from "zod";
import { createArtifact, getDocument, updateArtifact } from "../../clients/knowledge.js";
import { setActivePlanDocument } from "../../services/conversations.js";
import type { PlanToolContext } from "../tools/context.js";

const PLAN_CONTENT_DESCRIPTION =
  "Full plan Markdown. Must contain, in order: # 目标, ## 背景与约束, ## 实施方案, ## 任务 (a checklist: - [ ] one step per line), ## 验收标准. " +
  "Encode concurrency in ## 任务: when several deliverables are mutually independent (they do not consume each other's output — e.g. an HTML page, a video, and a batch of posters), group them under a '### 并行产物（可同时生成）' subheading so execution can generate them in one concurrent batch. Keep any step that truly depends on another's output on its own line and note the dependency inline (e.g. '(依赖：上面的海报)'). Put all images of one request in a single step (one generate_images call with multiple prompts → one gallery), never one step per image.";

export const writePlanInputSchema = z.object({
  title: z.string().min(1).max(120),
  filename: z.string().min(1).max(160),
  content_md: z.string().min(1).max(40_000).describe(PLAN_CONTENT_DESCRIPTION),
});

export const updatePlanInputSchema = z.object({
  document_id: z.string().min(1).max(32),
  base_revision_id: z.string().min(1).max(80),
  content_md: z.string().min(1).max(40_000).describe(PLAN_CONTENT_DESCRIPTION),
});

export type PlanArtifactOutput = {
  ok: true;
  status: "persisted";
  document_id: string;
  revision_id: string;
  title: string;
  filename: string;
  kind: "plan";
  next_suggestion: string;
};

function planFilename(value: string): string {
  const base = value
    .replace(/[\\/:"*?<>|]+/g, "-")
    .replace(/\.md$/i, "")
    .replace(/-plan$/i, "")
    .trim()
    .slice(0, 150) || "task";
  return `${base}-plan.md`;
}

function output(document: { id: string; updated_at: string; title: string; filename: string }): PlanArtifactOutput {
  return {
    ok: true,
    status: "persisted",
    document_id: document.id,
    revision_id: document.updated_at,
    title: document.title,
    filename: document.filename,
    kind: "plan",
    next_suggestion:
      "If the user approves executing this plan and the work is medium or difficult, consider calling update_todos first in normal mode to create a visible checklist; skip it for clearly small or single-deliverable plans. Do not call update_todos while still in plan mode.",
  };
}

export async function writePlanTool(
  input: z.infer<typeof writePlanInputSchema>,
  { context, toolCallId }: { context: PlanToolContext; toolCallId: string },
): Promise<PlanArtifactOutput> {
  const document = await createArtifact({
    userId: context.userId,
    orgId: context.orgId,
    conversationId: context.conversationId,
    title: input.title,
    filename: planFilename(input.filename),
    content: input.content_md,
    mimeType: "text/markdown",
    idempotencyKey: toolCallId,
  });
  await setActivePlanDocument(context.conversationId, document.id);
  return output(document);
}

export async function updatePlanTool(
  input: z.infer<typeof updatePlanInputSchema>,
  { context }: { context: PlanToolContext; toolCallId: string },
): Promise<PlanArtifactOutput | { ok: false; conflict: true; error: string; revision_id?: string }> {
  const current = await getDocument(context.userId, input.document_id);
  if (current.conversation_id !== context.conversationId || current.kind !== "artifact") {
    return { ok: false, conflict: true, error: "active plan artifact was not found" };
  }
  if (current.updated_at !== input.base_revision_id) {
    return {
      ok: false,
      conflict: true,
      error: "plan revision conflict; read the latest plan before updating",
      revision_id: current.updated_at,
    };
  }
  const document = await updateArtifact({
    userId: context.userId,
    documentId: current.id,
    content: input.content_md,
    mimeType: "text/markdown",
    expectedUpdatedAt: current.updated_at,
  });
  await setActivePlanDocument(context.conversationId, document.id);
  return output(document);
}
