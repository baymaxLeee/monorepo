import { startTask, type Task } from "../../../infrastructure/clients/worker.js";

export async function startDurableTask(
  input: Parameters<typeof startTask>[0],
  signal?: AbortSignal,
  submit: typeof startTask = startTask,
): Promise<Task> {
  if (signal?.aborted) {
    throw new DOMException("aborted", "AbortError");
  }
  return submit(input);
}
