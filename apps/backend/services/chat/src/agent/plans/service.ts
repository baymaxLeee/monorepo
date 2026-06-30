import { z } from "zod";

import { createArtifact, getDocument, updateArtifact } from "../../clients/knowledge.js";
import { setActivePlanDocument } from "../../services/conversations.js";
import type { PlanToolContext } from "../tools/context.js";

const PLAN_TEMPLATE_HEADINGS = ["# 目标", "## 背景与约束", "## 实施方案", "## 任务", "## 验收标准"];

export const writePlanInputSchema = z.object({
  title: z.string().min(1).max(120),
  filename: z.string().min(1).max(160),
  content_md: z.string().min(1).max(40_000),
});

export const updatePlanInputSchema = z.object({
  document_id: z.string().min(1).max(32),
  base_revision_id: z.string().min(1).max(80),
  content_md: z.string().min(1).max(40_000),
});

export type PlanArtifactOutput = {
  ok: true;
  status: "persisted";
  document_id: string;
  revision_id: string;
  title: string;
  filename: string;
  kind: "plan";
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

function validatePlanMarkdown(content: string): void {
  const missing = PLAN_TEMPLATE_HEADINGS.filter((heading) => !content.includes(heading));
  if (missing.length) throw new Error(`plan markdown is missing required sections: ${missing.join(", ")}`);
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
  };
}

export async function writePlanTool(
  input: z.infer<typeof writePlanInputSchema>,
  { context, toolCallId }: { context: PlanToolContext; toolCallId: string },
): Promise<PlanArtifactOutput> {
  validatePlanMarkdown(input.content_md);
  const document = await createArtifact({
    userId: context.userId,
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
  validatePlanMarkdown(input.content_md);
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
