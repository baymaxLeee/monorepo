import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { FatalError, getWorkflowMetadata } from "workflow";

import { getDb } from "../../infrastructure/persistence/index.js";
import { tasks } from "../../infrastructure/persistence/schema.js";

// Claim before any paid side effect, including after a crash between start() and linkage.
export async function claimTaskStep(taskId: string): Promise<void> {
  "use step";
  const workflowRunId = getWorkflowMetadata().workflowRunId;
  const [row] = await getDb()
    .update(tasks)
    .set({ workflowRunId, status: "running", updatedAt: new Date() })
    .where(
      and(
        eq(tasks.id, taskId),
        inArray(tasks.status, ["queued", "running"]),
        or(isNull(tasks.workflowRunId), eq(tasks.workflowRunId, workflowRunId)),
      ),
    )
    .returning({ id: tasks.id });
  if (!row) throw new FatalError("Task is terminal or belongs to another workflow run");
}
