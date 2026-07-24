import { eq } from "drizzle-orm";

import { getDb } from "../../infrastructure/persistence/index.js";
import { tasks } from "../../infrastructure/persistence/schema.js";
import type { TaskProgress } from "./types.js";

// The owning service (chat) reads progress/terminal state by polling
// `GET /tasks/:id`; there is no outbound push (ADR-0035). Progress is written
// to `tasks.progress` here purely so that poll can surface it.
export async function reportTaskProgress(
  workflowRunId: string,
  progress: TaskProgress,
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
        progress: { ...(row.progress ?? {}), ...progress },
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, row.id));
  });
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
