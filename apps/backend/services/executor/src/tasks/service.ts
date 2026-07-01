import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { getRun, start } from "workflow/api";
import { WorkflowRunCancelledError } from "workflow/errors";

import { getDb } from "../db/index.js";
import { tasks } from "../db/schema.js";
import { ConflictError, NotFoundError, RequestError } from "../lib/errors.js";
import { getTaskType } from "./registry.js";
import type { TaskSnapshot } from "./types.js";

export interface CreateTaskInput {
  type: string;
  ownerService: string;
  ownerRef: string;
  payload: unknown;
}

type TaskRow = typeof tasks.$inferSelect;

function newTaskId(): string {
  return randomBytes(16).toString("hex");
}

function toSnapshot(row: TaskRow): TaskSnapshot {
  return {
    id: row.id,
    type: row.type,
    status: row.status as TaskSnapshot["status"],
    ownerService: row.ownerService,
    ownerRef: row.ownerRef,
    result: row.result ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

async function findByOwner(ownerService: string, ownerRef: string): Promise<TaskRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.ownerService, ownerService), eq(tasks.ownerRef, ownerRef)));
  return row;
}

async function findById(id: string): Promise<TaskRow | undefined> {
  const [row] = await getDb().select().from(tasks).where(eq(tasks.id, id));
  return row;
}

// Fire-and-forget completion watcher: the HTTP request that created the task
// returns immediately (non-blocking, per the plan's "align with Cursor/Codex"
// decision), so nothing else awaits this. `run.returnValue` resolves against
// the durable workflow run itself, not this process's memory, so calling it
// again from `reconcilePendingTasks()` after a restart is safe and resumes
// watching instead of re-running anything.
function watchCompletion(taskId: string, workflowRunId: string): void {
  const run = getRun(workflowRunId);
  void run.returnValue
    .then(async (result) => {
      await getDb()
        .update(tasks)
        .set({ status: "completed", result, updatedAt: new Date(), finishedAt: new Date() })
        .where(eq(tasks.id, taskId));
    })
    .catch(async (error: unknown) => {
      // Empirically verified (see agent_task_执行时服务 plan): Workflow
      // DevKit resolves run.cancel() within seconds even mid-step, rejecting
      // returnValue with WorkflowRunCancelledError — not a generic
      // AbortError. Use the SDK's own cross-module-safe check rather than
      // guessing at error.name.
      const cancelled = WorkflowRunCancelledError.is(error);
      await getDb()
        .update(tasks)
        .set({
          status: cancelled ? "cancelled" : "failed",
          error: cancelled ? null : String(error).slice(0, 2000),
          updatedAt: new Date(),
          finishedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));
    });
}

export async function createTask(input: CreateTaskInput): Promise<TaskSnapshot> {
  const taskType = getTaskType(input.type);
  if (!taskType) throw new RequestError(`unknown task type: ${input.type}`);
  const parsed = taskType.inputSchema.safeParse(input.payload);
  if (!parsed.success) {
    throw new RequestError("invalid task payload", { issues: parsed.error.issues });
  }

  const existing = await findByOwner(input.ownerService, input.ownerRef);
  if (existing) return toSnapshot(existing);

  const db = getDb();
  const id = newTaskId();
  const now = new Date();
  try {
    await db.insert(tasks).values({
      id,
      type: input.type,
      status: "queued",
      ownerService: input.ownerService,
      ownerRef: input.ownerRef,
      payload: input.payload,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    // Race: a concurrent request with the same (ownerService, ownerRef) won
    // the unique-index insert first. Idempotency means returning its task,
    // not erroring.
    const row = await findByOwner(input.ownerService, input.ownerRef);
    if (row) return toSnapshot(row);
    throw new ConflictError("failed to create task");
  }

  const run = await start(taskType.workflow, [parsed.data]);
  await db
    .update(tasks)
    .set({ workflowRunId: run.runId, status: "running", updatedAt: new Date() })
    .where(eq(tasks.id, id));
  watchCompletion(id, run.runId);

  const row = await findById(id);
  if (!row) throw new NotFoundError(`task ${id} not found after creation`);
  return toSnapshot(row);
}

export async function getTask(id: string): Promise<TaskSnapshot> {
  const row = await findById(id);
  if (!row) throw new NotFoundError(`task ${id} not found`);
  return toSnapshot(row);
}

export async function cancelTask(id: string): Promise<TaskSnapshot> {
  const row = await findById(id);
  if (!row) throw new NotFoundError(`task ${id} not found`);
  if (row.workflowRunId) {
    await getRun(row.workflowRunId)
      .cancel()
      .catch(() => undefined);
  }
  return toSnapshot(row);
}

// Restores watchers for tasks whose owning process crashed/restarted before
// their workflow finished. Safe to call on every boot: `run.returnValue`
// replays against the durable run, it does not re-execute anything.
export async function reconcilePendingTasks(): Promise<void> {
  const rows = await getDb().select().from(tasks).where(eq(tasks.status, "running"));
  for (const row of rows) {
    if (row.workflowRunId) watchCompletion(row.id, row.workflowRunId);
  }
}
