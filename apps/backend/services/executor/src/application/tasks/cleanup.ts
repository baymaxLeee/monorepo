import { and, eq } from "drizzle-orm";
import { getRun } from "workflow/api";

import { getDb } from "../../infrastructure/persistence/index.js";
import { tasks } from "../../infrastructure/persistence/schema.js";
import { getTaskType } from "./registry.js";

const active = new Set<string>();
export async function cleanupCancelledTask(id: string): Promise<void> {
  if (active.has(id)) return;
  active.add(id);
  try {
    const [row] = await getDb()
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.cleanupPending, true)));
    if (!row || (row.status !== "cancelled" && row.status !== "failed")) return;
    if (row.workflowRunId) {
      const run = getRun(row.workflowRunId);
      const status = await run.status;
      if (status !== "completed" && status !== "failed" && status !== "cancelled") await run.cancel();
    }
    const definition = getTaskType(row.type);
    if (definition?.cancel && (row.workflowRunId || row.progress?.externalTaskIds?.length)) {
      const parsed = definition.inputSchema.parse(row.payload);
      await definition.cancel(parsed, row.progress ?? null, { taskId: row.id });
    }
    // A provider task may have been recorded while cleanup was in flight.
    await getDb()
      .update(tasks)
      .set({ cleanupPending: false })
      .where(and(eq(tasks.id, id), eq(tasks.updatedAt, row.updatedAt)));
  } finally {
    active.delete(id);
  }
}
export async function reconcileTaskCleanup(): Promise<void> {
  const rows = await getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.cleanupPending, true));
  await Promise.all(
    rows.map(async (row) => {
      try {
        await cleanupCancelledTask(row.id);
      } catch (error) {
        console.error("[executor] cancellation cleanup will retry", { taskId: row.id, error });
      }
    }),
  );
}
export function startTaskCleanupRecovery(): void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void reconcileTaskCleanup()
      .catch((error) => console.error("[executor] cleanup recovery failed", { error }))
      .finally(() => {
        running = false;
      });
  }, 5000);
  timer.unref();
}
