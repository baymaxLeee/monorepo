import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { getRun, start } from "workflow/api";
import { WorkflowRunCancelledError } from "workflow/errors";

import { getDb } from "../../infrastructure/persistence/index.js";
import { tasks } from "../../infrastructure/persistence/media-schema.js";
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
    progress: row.progress
      ? {
          done: row.progress.done,
          total: row.progress.total,
          ...(row.progress.text !== undefined && { text: row.progress.text }),
        }
      : null,
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

const completionWatchers = new Map<string, Promise<void>>();

export function waitForTaskCompletion(taskId: string, workflowRunId: string): Promise<void> {
  const existing = completionWatchers.get(workflowRunId);
  if (existing) return existing;
  const watcher = settleTaskCompletion(taskId, workflowRunId).finally(() => {
    completionWatchers.delete(workflowRunId);
  });
  completionWatchers.set(workflowRunId, watcher);
  return watcher;
}

function watchCompletion(taskId: string, workflowRunId: string): void {
  void waitForTaskCompletion(taskId, workflowRunId).catch((error: unknown) => {
    console.error("[runtime-worker] task completion watcher failed", { taskId, workflowRunId, error });
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
    if (existing.type !== input.type) {
      throw new ConflictError("task owner already belongs to another task type");
    }
    if (!isDeepStrictEqual(existing.payload, parsed.data)) {
      throw new ConflictError("task owner was already used with a different payload");
    }
    if (!taskType.retryFailedOnCreate || existing.status !== "failed") {
      if (!existing.workflowRunId && ["queued", "running"].includes(existing.status)) {
        await dispatchTask(existing.id);
        return toSnapshot((await findById(existing.id)) ?? existing);
      }
      return toSnapshot(existing);
    }
    const [restarted] = await getDb()
      .update(tasks)
      .set({
        status: "queued",
        workflowRunId: null,
        cleanupPending: false,
        payload: parsed.data,
        result: null,
        progress: null,
        error: null,
        updatedAt: new Date(),
        finishedAt: null,
      })
      .where(and(eq(tasks.id, existing.id), eq(tasks.status, "failed")))
      .returning({ id: tasks.id });
    if (!restarted) {
      const current = await findByOwner(input.ownerService, input.ownerRef);
      if (!current) throw new ConflictError("task owner changed while restarting failed task");
      return toSnapshot(current);
    }
  }

  const db = getDb();
  const id = existing?.id ?? newTaskId();
  const now = new Date();
  if (!existing) {
    try {
      await db.insert(tasks).values({
        id,
        type: input.type,
        status: "queued",
        ownerService: input.ownerService,
        ownerRef: input.ownerRef,
        payload: parsed.data,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      const row = await findByOwner(input.ownerService, input.ownerRef);
      if (row) {
        if (row.type !== input.type) throw new ConflictError("task owner already belongs to another task type");
        if (!isDeepStrictEqual(row.payload, parsed.data)) {
          throw new ConflictError("task owner was already used with a different payload");
        }
        if (!row.workflowRunId && ["queued", "running"].includes(row.status)) await dispatchTask(row.id);
        return toSnapshot((await findById(row.id)) ?? row);
      }
      throw new ConflictError("failed to create task");
    }
  }

  await dispatchTask(id);

  const row = await findById(id);
  if (!row) {
    throw new NotFoundError(`task ${id} not found after creation`);
  }
  if (row.status === "cancelled") {
    await db.update(tasks).set({ cleanupPending: true, updatedAt: new Date() }).where(eq(tasks.id, id));
    await cleanupCancelledTask(id).catch((error) =>
      console.error("[runtime-worker] cleanup will retry", { taskId: id, error }),
    );
  }
  return toSnapshot(row);
}

async function dispatchTask(id: string): Promise<void> {
  const row = await findById(id);
  if (!row || !["queued", "running"].includes(row.status)) return;
  if (row.workflowRunId) {
    watchCompletion(row.id, row.workflowRunId);
    return;
  }
  const definition = getTaskType(row.type);
  const parsed = definition?.inputSchema.safeParse(row.payload);
  if (!definition || !parsed?.success) {
    await getDb()
      .update(tasks)
      .set({
        status: "failed",
        error: definition ? "persisted task payload is invalid" : `unknown persisted task type: ${row.type}`,
        updatedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(and(eq(tasks.id, id), isNull(tasks.workflowRunId), inArray(tasks.status, ["queued", "running"])));
    return;
  }

  let run: Awaited<ReturnType<typeof start>>;
  try {
    run = await start(definition.workflow, [parsed.data, id], { attributes: { runtimeTaskId: id } });
  } catch (error) {
    // start() can fail after the World accepted the run. Keep the durable
    // admission queued: a candidate run must claim this task before any side
    // effect, and recovery may safely start another candidate if necessary.
    console.error("[runtime-worker] workflow dispatch will retry", { taskId: id, error });
    return;
  }

  const [linked] = await getDb()
    .update(tasks)
    .set({ workflowRunId: run.runId, status: "running", error: null, updatedAt: new Date() })
    .where(and(eq(tasks.id, id), isNull(tasks.workflowRunId), inArray(tasks.status, ["queued", "running"])))
    .returning({ id: tasks.id });
  if (linked) {
    watchCompletion(id, run.runId);
    return;
  }

  const current = await findById(id);
  if (current?.workflowRunId === run.runId) {
    watchCompletion(id, run.runId);
    return;
  }
  // Another candidate claimed the task, or cancellation won while start was
  // in flight. This run cannot pass claimTaskStep, but cancelling it releases
  // World resources sooner.
  await run.cancel().catch(() => undefined);
  if (current?.workflowRunId) watchCompletion(id, current.workflowRunId);
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
    console.error("[runtime-worker] cancellation cleanup will retry", { taskId: id, error }),
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
  for (const row of rows) {
    if (row.workflowRunId) {
      watchCompletion(row.id, row.workflowRunId);
    } else {
      await dispatchTask(row.id);
    }
  }
}

let pendingTaskRecoveryTimer: ReturnType<typeof setInterval> | undefined;
let pendingTaskRecoveryRun: Promise<void> | undefined;

export function startPendingTaskRecovery(): void {
  if (pendingTaskRecoveryTimer) return;
  pendingTaskRecoveryTimer = setInterval(() => {
    if (pendingTaskRecoveryRun) return;
    pendingTaskRecoveryRun = reconcilePendingTasks()
      .catch((error) => console.error("[runtime-worker] pending task recovery failed", { error }))
      .finally(() => {
        pendingTaskRecoveryRun = undefined;
      });
  }, 5_000);
  pendingTaskRecoveryTimer.unref();
}

export async function stopPendingTaskRecovery(): Promise<void> {
  if (pendingTaskRecoveryTimer) {
    clearInterval(pendingTaskRecoveryTimer);
    pendingTaskRecoveryTimer = undefined;
  }
  await pendingTaskRecoveryRun;
}
