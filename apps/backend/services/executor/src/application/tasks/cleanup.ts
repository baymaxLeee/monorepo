import { and, eq } from "drizzle-orm";
import { getRun } from "workflow/api";

import { getDb, getSql } from "../../infrastructure/persistence/index.js";
import { tasks } from "../../infrastructure/persistence/schema.js";
import { getTaskType } from "./registry.js";

function cleanupLockKey(id: string): string {
  return BigInt.asIntN(64, BigInt(`0x${id.slice(0, 16)}`)).toString();
}

export async function cleanupCancelledTask(id: string): Promise<void> {
  const connection = await getSql().reserve();
  try {
    const result = await connection.unsafe<{ locked: boolean }[]>("SELECT pg_try_advisory_lock($1::bigint) AS locked", [
      cleanupLockKey(id),
    ]);
    const locked = result[0]?.locked ?? false;
    if (!locked) return;
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
    await connection.unsafe("SELECT pg_advisory_unlock($1::bigint)", [cleanupLockKey(id)]);
    connection.release();
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
