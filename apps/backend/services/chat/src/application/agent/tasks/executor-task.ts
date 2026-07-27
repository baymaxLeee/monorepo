import { TransportError } from "@backend/transport-ts";

import {
  cancelTask,
  startTask,
  type Task,
  type TaskWatchFrame,
  watchTask,
} from "../../../infrastructure/clients/executor.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { NotFoundError } from "../../errors.js";

export const TASK_STREAM_RECONNECT_MS = 1_500;

export const MAX_CONSECUTIVE_STREAM_FAILURES = 20;

export const MAX_TASK_WAIT_MS = 30 * 60_000;

export class TaskWaitTimeoutError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId} did not finish within ${Math.round(MAX_TASK_WAIT_MS / 60_000)} minutes`);
    this.name = "TaskWaitTimeoutError";
  }
}

export function isTransientTaskWatchError(error: unknown): boolean {
  if (error instanceof NotFoundError) {
    return false;
  }
  if (error instanceof TransportError) {
    return error.status >= 500 || error.status === 429;
  }
  return true;
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isTerminalStatus(status: Task["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export async function* watchTaskSnapshots(
  taskId: string,
  ownerRef: string,
  signal?: AbortSignal,
): AsyncGenerator<TaskWatchFrame, TaskWatchFrame> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), MAX_TASK_WAIT_MS);
  const watchSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
  let consecutiveFailures = 0;
  let lastKey: string | null = null;

  const emitFresh = (frame: TaskWatchFrame): boolean => {
    const key = `${frame.task.updatedAt}:${frame.production?.version ?? ""}`;
    if (key === lastKey) {
      return false;
    }
    lastKey = key;
    return true;
  };

  try {
    while (true) {
      if (signal?.aborted) {
        await cancelTask(taskId, ownerRef);
        throw new DOMException("aborted", "AbortError");
      }
      if (timeoutController.signal.aborted) {
        await cancelTask(taskId, ownerRef);
        throw new TaskWaitTimeoutError(taskId);
      }

      let failure: unknown = new Error(`task ${taskId} status stream ended before a terminal snapshot`);
      try {
        for await (const frame of watchTask(taskId, ownerRef, watchSignal)) {
          if (emitFresh(frame)) {
            consecutiveFailures = 0;
            yield frame;
          }
          if (isTerminalStatus(frame.task.status)) {
            return frame;
          }
        }
      } catch (error) {
        failure = error;
      }

      if (signal?.aborted) {
        await cancelTask(taskId, ownerRef);
        throw new DOMException("aborted", "AbortError");
      }
      if (timeoutController.signal.aborted) {
        await cancelTask(taskId, ownerRef);
        throw new TaskWaitTimeoutError(taskId);
      }
      if (!isTransientTaskWatchError(failure)) {
        throw failure;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_STREAM_FAILURES) {
        throw failure;
      }
      logger.warn(
        { taskId, consecutiveFailures, err: String(failure).slice(0, 200) },
        "task status stream interrupted, reconnecting",
      );
      await abortableDelay(TASK_STREAM_RECONNECT_MS, watchSignal);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function startExecutorTask(input: Parameters<typeof startTask>[0], signal?: AbortSignal): Promise<Task> {
  if (signal?.aborted) {
    throw new DOMException("aborted", "AbortError");
  }
  return startTask(input);
}
