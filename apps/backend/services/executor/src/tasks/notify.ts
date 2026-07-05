import { eq } from "drizzle-orm";

import { notifyTaskEvent, type TaskEventNotification } from "../clients/chat.js";
import { getDb } from "../db/index.js";
import { tasks } from "../db/schema.js";
import type { TaskProgress } from "./types.js";

type TaskRow = typeof tasks.$inferSelect;

function extractConversationId(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "conversationId" in payload) {
    const value = (payload as { conversationId?: unknown }).conversationId;
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function notifyOwner(row: TaskRow): void {
  if (row.ownerService !== "chat") return;
  const conversationId = extractConversationId(row.payload);
  if (!conversationId) return;
  const event: TaskEventNotification = {
    taskId: row.id,
    conversationId,
    ownerRef: row.ownerRef,
    type: row.type,
    status: row.status as TaskEventNotification["status"],
    progress: row.progress
      ? { done: row.progress.done, total: row.progress.total }
      : null,
    result: row.result ?? null,
    error: row.error ?? null,
  };
  void notifyTaskEvent(event).catch((error) => {
    console.error("[executor] task notification failed (non-fatal)", {
      taskId: row.id,
      status: row.status,
      error,
    });
  });
}

export async function notifyOwnerById(taskId: string): Promise<void> {
  const [row] = await getDb().select().from(tasks).where(eq(tasks.id, taskId));
  if (row) notifyOwner(row);
}

export async function reportTaskProgress(
  workflowRunId: string,
  progress: TaskProgress,
): Promise<void> {
  const db = getDb();
  let taskId: string | null = null;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.workflowRunId, workflowRunId))
      .for("update");
    if (!row) return;
    taskId = row.id;
    await tx
      .update(tasks)
      .set({
        progress: { ...(row.progress ?? {}), done: progress.done, total: progress.total },
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, row.id));
  });
  if (taskId) await notifyOwnerById(taskId);
}

export async function recordArtifactGeneration(
  workflowRunId: string,
  generationId: string,
): Promise<void> {
  await updateRuntimeProgress(workflowRunId, (progress) => ({
    ...progress,
    artifactGenerationId: generationId,
  }));
}

export async function recordExternalTask(
  workflowRunId: string,
  externalTaskId: string,
): Promise<void> {
  await updateRuntimeProgress(workflowRunId, (progress) => ({
    ...progress,
    externalTaskIds: [...new Set([...(progress.externalTaskIds ?? []), externalTaskId])],
  }));
}

export async function isTaskCancelled(workflowRunId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.workflowRunId, workflowRunId));
  return row?.status === "cancelled";
}

async function updateRuntimeProgress(
  workflowRunId: string,
  update: (progress: TaskProgress) => TaskProgress,
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.workflowRunId, workflowRunId))
      .for("update");
    if (!row) return;
    await tx
      .update(tasks)
      .set({
        progress: update(row.progress ?? { done: 0, total: 0 }),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, row.id));
  });
}
