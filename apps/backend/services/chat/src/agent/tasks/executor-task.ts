import { TransportError } from "@backend/transport-ts";

import { cancelTask, getTask, startTask, type Task } from "../../clients/executor.js";
import { NotFoundError } from "../../lib/errors.js";

export const TASK_POLL_MS = 1_500;

export const MAX_CONSECUTIVE_POLL_FAILURES = 20;

export const MAX_TASK_WAIT_MS = 30 * 60_000;

export class TaskWaitTimeoutError extends Error {
  constructor(taskId: string) {
    super(
      `task ${taskId} did not finish within ${Math.round(MAX_TASK_WAIT_MS / 60_000)} minutes`,
    );
    this.name = "TaskWaitTimeoutError";
  }
}

export function isTransientPollError(error: unknown): boolean {
  if (error instanceof NotFoundError) return false;
  if (error instanceof TransportError) return error.status >= 500 || error.status === 429;
  return true;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
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

export async function waitForTaskTerminal(taskId: string, signal?: AbortSignal): Promise<Task> {
  const deadline = Date.now() + MAX_TASK_WAIT_MS;
  let consecutiveFailures = 0;
  while (true) {
    if (signal?.aborted) {
      await cancelTask(taskId).catch(() => undefined);
      throw new DOMException("aborted", "AbortError");
    }
    if (Date.now() >= deadline) {
      await cancelTask(taskId).catch(() => undefined);
      throw new TaskWaitTimeoutError(taskId);
    }
    try {
      const task = await getTask(taskId);
      consecutiveFailures = 0;
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        return task;
      }
    } catch (error) {
      if (!isTransientPollError(error)) throw error;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw error;
      console.warn("[chat-agent] task poll transient failure, retrying", {
        taskId,
        consecutiveFailures,
        error: String(error).slice(0, 200),
      });
    }
    await abortableSleep(TASK_POLL_MS, signal);
  }
}

export async function startTaskResilient(
  input: Parameters<typeof startTask>[0],
  signal?: AbortSignal,
): Promise<Task> {
  let attempts = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      return await startTask(input);
    } catch (error) {
      attempts += 1;
      if (!isTransientPollError(error) || attempts >= 5) throw error;
      console.warn("[chat-agent] task dispatch transient failure, retrying", {
        ownerRef: input.ownerRef,
        attempts,
        error: String(error).slice(0, 200),
      });
      await abortableSleep(TASK_POLL_MS, signal);
    }
  }
}
