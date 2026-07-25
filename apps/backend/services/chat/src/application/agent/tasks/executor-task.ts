import { TransportError } from "@backend/transport-ts";

import { cancelTask, getTask, startTask, type Task } from "../../../infrastructure/clients/executor.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { NotFoundError } from "../../errors.js";

export const TASK_POLL_MS = 1_500;

export const MAX_CONSECUTIVE_POLL_FAILURES = 20;

export const MAX_TASK_WAIT_MS = 30 * 60_000;

export class TaskWaitTimeoutError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId} did not finish within ${Math.round(MAX_TASK_WAIT_MS / 60_000)} minutes`);
    this.name = "TaskWaitTimeoutError";
  }
}

export function isTransientPollError(error: unknown): boolean {
  if (error instanceof NotFoundError) {
    return false;
  }
  if (error instanceof TransportError) {
    return error.status >= 500 || error.status === 429;
  }
  return true;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function isTerminalStatus(status: Task["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/**
 * Poll a durable executor task, yielding every fresh snapshot (including the
 * live `progress` counter) and returning once terminal. The final terminal
 * snapshot is BOTH the last `yield` and the return value, so a generator tool
 * wrapper can surface progress as preliminary tool-results and still expose the
 * terminal state. This is the single progress source for executor-backed
 * deliverables (HTML artifact / video) — there is no separate SSE channel.
 */
export async function* pollTaskSnapshots(
  taskId: string,
  ownerRef: string,
  signal?: AbortSignal,
): AsyncGenerator<Task, Task> {
  const deadline = Date.now() + MAX_TASK_WAIT_MS;
  let consecutiveFailures = 0;
  while (true) {
    if (signal?.aborted) {
      await cancelTask(taskId, ownerRef);
      throw new DOMException("aborted", "AbortError");
    }
    if (Date.now() >= deadline) {
      await cancelTask(taskId, ownerRef);
      throw new TaskWaitTimeoutError(taskId);
    }
    try {
      const task = await getTask(taskId, ownerRef);
      consecutiveFailures = 0;
      yield task;
      if (isTerminalStatus(task.status)) {
        return task;
      }
    } catch (error) {
      if (!isTransientPollError(error)) {
        throw error;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw error;
      }
      logger.warn(
        { taskId, consecutiveFailures, err: String(error).slice(0, 200) },
        "task poll transient failure, retrying",
      );
    }
    await abortableSleep(TASK_POLL_MS, signal);
  }
}

export async function startExecutorTask(input: Parameters<typeof startTask>[0], signal?: AbortSignal): Promise<Task> {
  if (signal?.aborted) {
    throw new DOMException("aborted", "AbortError");
  }
  return startTask(input);
}
