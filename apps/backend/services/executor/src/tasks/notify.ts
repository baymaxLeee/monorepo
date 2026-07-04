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
    progress: row.progress ?? null,
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
  const [row] = await db.select().from(tasks).where(eq(tasks.workflowRunId, workflowRunId));
  if (!row) return;
  await db
    .update(tasks)
    .set({ progress, updatedAt: new Date() })
    .where(eq(tasks.id, row.id));
  notifyOwner({ ...row, progress });
}
