import { eq } from "drizzle-orm";

import { notifyTaskEvent, type TaskEventNotification } from "../clients/chat.js";
import { getDb } from "../db/index.js";
import { tasks } from "../db/schema.js";
import type { TaskProgress } from "./types.js";

type TaskRow = typeof tasks.$inferSelect;

// Task payloads are TaskType-specific, but every owner that wants live updates
// carries the routing key it needs on the payload. chat puts the conversationId
// there so we can address the right resumable stream without a second table.
function extractConversationId(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "conversationId" in payload) {
    const value = (payload as { conversationId?: unknown }).conversationId;
    if (typeof value === "string" && value) return value;
  }
  return null;
}

// Fire-and-forget: a dropped notification must never fail or slow a task. The
// owner also gets the durable truth from GET /tasks/{id} (and, for chat, the
// task stream re-seeds the current snapshot on connect), so at-most-once here is
// acceptable — this is a latency optimization, not the source of truth.
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

// Called from inside a workflow step after each unit of work completes. Locates
// the business task by its durable run id (assigned by createTask before the
// workflow does any real work), records the counter, and pushes it to the owner.
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
