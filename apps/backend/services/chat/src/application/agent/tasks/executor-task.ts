import { startTask, type Task } from "../../../infrastructure/clients/executor.js";

export async function startExecutorTask(
  input: Parameters<typeof startTask>[0],
  signal?: AbortSignal,
  submit: typeof startTask = startTask,
): Promise<Task> {
  if (signal?.aborted) {
    throw new DOMException("aborted", "AbortError");
  }
  return submit(input);
}
