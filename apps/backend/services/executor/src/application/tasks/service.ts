import { randomBytes } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { getRun, start } from "workflow/api";
import { WorkflowRunCancelledError } from "workflow/errors";

import { getDb } from "../../infrastructure/persistence/index.js";
import { tasks } from "../../infrastructure/persistence/schema.js";
import { ConflictError, NotFoundError, RequestError } from "../errors.js";
import { cleanupCancelledTask } from "./cleanup.js";
import { getTaskType } from "./registry.js";
import type { TaskSnapshot } from "./types.js";

export interface TaskOwner {
  service: string;
  ref?: string;
}

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

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error) ?? "workflow start failed";
  } catch {
    return `workflow start failed with ${typeof error}`;
  }
}

function toSnapshot(row: TaskRow): TaskSnapshot {
  return {
    id: row.id,
    type: row.type,
    status: row.status as TaskSnapshot["status"],
    ownerService: row.ownerService,
    ownerRef: row.ownerRef,
    result: row.result ?? null,
    progress: row.progress ? { done: row.progress.done, total: row.progress.total } : null,
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

function assertTaskOwner(row: TaskRow, owner: TaskOwner): void {
  if (row.ownerService !== owner.service || (owner.ref !== undefined && row.ownerRef !== owner.ref)) {
    throw new NotFoundError(`task ${row.id} not found`);
  }
}

export async function settleTaskCompletion(taskId: string, workflowRunId: string): Promise<void> {
  const run = getRun(workflowRunId);
  let result: unknown;
  try {
    result = await run.returnValue;
  } catch (error) {
    const cancelled = WorkflowRunCancelledError.is(error);
    await getDb()
      .update(tasks)
      .set({
        status: cancelled ? "cancelled" : "failed",
        cleanupPending: true,
        error: cancelled ? null : errorMessage(error).slice(0, 2000),
        updatedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), inArray(tasks.status, ["queued", "running"])));
    return;
  }
  await getDb()
    .update(tasks)
    .set({ status: "completed", result, updatedAt: new Date(), finishedAt: new Date() })
    .where(and(eq(tasks.id, taskId), inArray(tasks.status, ["queued", "running"])));
}

function watchCompletion(taskId: string, workflowRunId: string): void {
  void settleTaskCompletion(taskId, workflowRunId).catch((error: unknown) => {
    console.error("[executor] task completion watcher failed", { taskId, workflowRunId, error });
  });
}

export async function createTask(input: CreateTaskInput): Promise<TaskSnapshot> {
  const taskType = getTaskType(input.type);
  if (!taskType) {
    throw new RequestError(`unknown task type: ${input.type}`);
  }
  const parsed = taskType.inputSchema.safeParse(input.payload);
  if (!parsed.success) {
    throw new RequestError("invalid task payload", { issues: parsed.error.issues });
  }

  const existing = await findByOwner(input.ownerService, input.ownerRef);
  if (existing) {
    return toSnapshot(existing);
  }

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
    const row = await findByOwner(input.ownerService, input.ownerRef);
    if (row) {
      return toSnapshot(row);
    }
    throw new ConflictError("failed to create task");
  }

  let run: Awaited<ReturnType<typeof start>>;
  try {
    run = await start(taskType.workflow, [parsed.data, id]);
  } catch (error) {
    await db
      .update(tasks)
      .set({
        status: "failed",
        error: `workflow start failed: ${errorMessage(error).slice(0, 1900)}`,
        updatedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(and(eq(tasks.id, id), isNull(tasks.workflowRunId), eq(tasks.status, "queued")));
    throw error;
  }
  try {
    await db
      .update(tasks)
      .set({ workflowRunId: run.runId, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), isNull(tasks.workflowRunId)));
    await db
      .update(tasks)
      .set({ status: "running", updatedAt: new Date() })
      .where(and(eq(tasks.id, id), eq(tasks.status, "queued")));
  } catch (error) {
    await run.cancel().catch(() => undefined);
    await db
      .update(tasks)
      .set({
        status: "failed",
        workflowRunId: run.runId,
        cleanupPending: true,
        error: `workflow started but task linkage failed: ${errorMessage(error).slice(0, 1800)}`,
        updatedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(and(eq(tasks.id, id), inArray(tasks.status, ["queued", "running"])))
      .catch(() => undefined);
    throw error;
  }
  watchCompletion(id, run.runId);

  const row = await findById(id);
  if (!row) {
    throw new NotFoundError(`task ${id} not found after creation`);
  }
  if (row.status === "cancelled") {
    await db.update(tasks).set({ cleanupPending: true, updatedAt: new Date() }).where(eq(tasks.id, id));
    await cleanupCancelledTask(id).catch((error) =>
      console.error("[executor] cleanup will retry", { taskId: id, error }),
    );
  }
  return toSnapshot(row);
}

export async function getTask(id: string, owner: TaskOwner): Promise<TaskSnapshot> {
  const row = await findById(id);
  if (!row) {
    throw new NotFoundError(`task ${id} not found`);
  }
  assertTaskOwner(row, owner);
  return toSnapshot(row);
}

export async function getTaskWatchSource(
  id: string,
  owner: TaskOwner,
): Promise<{ task: TaskSnapshot; workflowRunId: string | null }> {
  const row = await findById(id);
  if (!row) {
    throw new NotFoundError(`task ${id} not found`);
  }
  assertTaskOwner(row, owner);
  return {
    task: toSnapshot(row),
    workflowRunId: row.workflowRunId,
  };
}

export async function cancelTask(id: string, owner: TaskOwner): Promise<TaskSnapshot> {
  const row = await findById(id);
  if (!row) throw new NotFoundError(`task ${id} not found`);
  assertTaskOwner(row, owner);
  if (row.status === "completed" || row.status === "failed") return toSnapshot(row);
  const now = new Date();
  await getDb()
    .update(tasks)
    .set({ status: "cancelled", cleanupPending: true, updatedAt: now, finishedAt: now })
    .where(and(eq(tasks.id, id), inArray(tasks.status, ["queued", "running", "cancelled"])));
  await cleanupCancelledTask(id).catch((error) =>
    console.error("[executor] cancellation cleanup will retry", { taskId: id, error }),
  );
  const current = await findById(id);
  if (!current) throw new NotFoundError(`task ${id} not found after cancellation`);
  return toSnapshot(current);
}

export async function cancelTaskByOwner(ownerService: string, ownerRef: string, type: string): Promise<TaskSnapshot> {
  const now = new Date();
  await getDb()
    .insert(tasks)
    .values({
      id: newTaskId(),
      type,
      status: "cancelled",
      ownerService,
      ownerRef,
      payload: {},
      createdAt: now,
      updatedAt: now,
      finishedAt: now,
    })
    .onConflictDoNothing({ target: [tasks.ownerService, tasks.ownerRef] });
  const row = await findByOwner(ownerService, ownerRef);
  if (!row) throw new NotFoundError("task owner not found");
  // A tombstone has no workflow or provider work to clean up.
  if (row.status === "cancelled" && !row.workflowRunId && !row.cleanupPending) return toSnapshot(row);
  return cancelTask(row.id, { service: ownerService, ref: ownerRef });
}

export async function reconcilePendingTasks(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, ["queued", "running"]));
  const now = new Date();
  for (const row of rows) {
    if (row.workflowRunId) {
      watchCompletion(row.id, row.workflowRunId);
    } else {
      await db
        .update(tasks)
        .set({
          status: "failed",
          error: "orphaned before workflow start (process restarted mid-create)",
          updatedAt: now,
          finishedAt: now,
        })
        .where(and(eq(tasks.id, row.id), isNull(tasks.workflowRunId), inArray(tasks.status, ["queued", "running"])));
    }
  }
}
