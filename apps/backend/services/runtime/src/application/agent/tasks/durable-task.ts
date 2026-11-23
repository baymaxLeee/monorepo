import { getTask, startTask, watchTask, type Task } from "../../../infrastructure/clients/worker.js";

type StartTaskInput = Parameters<typeof startTask>[0];

interface DurableTaskClient {
  start(input: StartTaskInput): Promise<Task>;
  get(id: string, ownerRef: string): Promise<Task>;
  watch(id: string, ownerRef: string, signal?: AbortSignal): AsyncIterable<{ task: Task }>;
  waitBeforeReconnect(signal?: AbortSignal): Promise<void>;
}

const client: DurableTaskClient = {
  start: startTask,
  get: getTask,
  watch: watchTask,
  waitBeforeReconnect: (signal) =>
    new Promise((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
      };
      const timer = setTimeout(finish, 250);
      timer.unref();
      signal?.addEventListener("abort", abort, { once: true });
    }),
};

function terminal(task: Task): boolean {
  return task.status === "completed" || task.status === "failed" || task.status === "cancelled";
}

function completed(task: Task): Task {
  if (task.status === "completed") return task;
  if (task.status === "cancelled") throw new Error(`durable task ${task.id} was cancelled`);
  throw new Error(task.error?.trim() || `durable task ${task.id} failed`);
}

/**
 * Admits one idempotent durable task and keeps the tool call attached until the
 * task is terminal. If the server or stream reconnects, the same ownerRef
 * resolves the existing task instead of starting a second provider operation.
 */
export async function runDurableTask(
  input: StartTaskInput,
  signal?: AbortSignal,
  taskClient: DurableTaskClient = client,
): Promise<Task> {
  signal?.throwIfAborted();
  let task = await taskClient.start(input);
  if (terminal(task)) return completed(task);

  while (true) {
    signal?.throwIfAborted();
    for await (const frame of taskClient.watch(task.id, input.ownerRef, signal)) {
      task = frame.task;
      if (terminal(task)) return completed(task);
    }

    // A stream may end while admission is still queued and has no Workflow run
    // linked yet. Re-read committed state, then reconnect without resubmitting.
    signal?.throwIfAborted();
    task = await taskClient.get(task.id, input.ownerRef);
    if (terminal(task)) return completed(task);
    await taskClient.waitBeforeReconnect(signal);
  }
}
