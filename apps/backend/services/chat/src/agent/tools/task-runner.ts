// Shared helpers for tools that dispatch a durable executor task and then
// foreground-block the current agent turn until it finishes. Extracted from the
// HTML-artifact tool so image/video (and any future) generation tools reuse the
// exact same dispatch + resilient-poll + cancel-on-abort semantics instead of
// re-deriving them (see chat AGENTS.md "Tools and artifacts").
import { TransportError } from "@backend/transport-ts";

import { cancelTask, getTask, startTask, type Task } from "../../clients/executor.js";
import { NotFoundError } from "../../lib/errors.js";

// How often we re-read the durable task snapshot while foreground-blocking. The
// live per-unit progress (if any) streams over the task's own resumable stream;
// this poll is only the authoritative control-flow signal that decides when the
// tool call returns, so a coarse interval is fine.
export const TASK_POLL_MS = 1_500;

// A durable executor task survives brief executor unavailability (Nitro dev HMR
// rebuild, a redeploy, a transient 5xx/network blip), so the blocking waiter
// keeps polling through those. Give up only after this many *consecutive* poll
// failures (~30s of continuous unavailability), meaning executor is genuinely
// down rather than just reloading.
export const MAX_CONSECUTIVE_POLL_FAILURES = 20;

// Hard ceiling on how long a tool blocks waiting for a background task. Sized
// for the largest expected workload (a ~100-page HTML deck; a minutes-scale
// video generation) with headroom. A task still running past this is treated as
// stuck: the waiter cancels it and fails the tool call rather than blocking the
// turn (and the user) indefinitely.
export const MAX_TASK_WAIT_MS = 30 * 60_000;

// Distinguishes "waited too long" from an abort or a fatal poll error so a tool
// can surface a clear, user-facing timeout message instead of a generic failure.
export class TaskWaitTimeoutError extends Error {
  constructor(taskId: string) {
    super(
      `task ${taskId} did not finish within ${Math.round(MAX_TASK_WAIT_MS / 60_000)} minutes`,
    );
    this.name = "TaskWaitTimeoutError";
  }
}

// A missing task (404) is fatal — the row is genuinely gone. Anything else from
// a poll (5xx from Nitro's dev proxy mid-reload, a timeout, a network error) is
// transient: the task keeps running server-side, so retry rather than fail the
// whole turn on a blip.
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

// Foreground-block on a dispatched executor task until it reaches a terminal
// state, returning the authoritative durable snapshot. On abort (user Stop) it
// cancels the task and throws AbortError so the run is recorded as cancelled.
// Transient poll failures are tolerated (see isTransientPollError) so a dev
// rebuild or redeploy mid-generation does not fail an otherwise-healthy task.
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

// Dispatch is idempotent on executor (owner_service+owner_ref == toolCallId), so
// retrying a transiently-failed start just returns the same task — safe to ride
// out a dev rebuild / redeploy blip here too, with a shorter cap since a task
// that never starts should surface quickly.
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
