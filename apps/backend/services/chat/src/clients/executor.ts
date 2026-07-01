import { ExecutorInternalClient, TransportError, type Task } from "@backend/transport-ts";

import { getSettings } from "../config.js";
import { NotFoundError } from "../lib/errors.js";

export type { Task } from "@backend/transport-ts";

function executorClient(): ExecutorInternalClient {
  const s = getSettings();
  return new ExecutorInternalClient({
    baseUrl: s.executorServiceUrl,
    internalToken: s.internalApiToken,
  });
}

export async function startTask(input: {
  type: string;
  ownerRef: string;
  payload: unknown;
}): Promise<Task> {
  return executorClient().startTask({
    type: input.type,
    owner_service: "chat",
    owner_ref: input.ownerRef,
    payload: input.payload,
  });
}

export async function getTask(id: string): Promise<Task> {
  try {
    return await executorClient().getTask(id);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new NotFoundError(`task ${id} not found`);
    }
    throw err;
  }
}

// Best-effort: a write_file/edit_file tool that is aborted (user Stop) cancels
// the executor task it is foreground-blocking on. Workflow DevKit's run.cancel()
// interrupts the in-flight step within seconds; a 404 means it already finished.
export async function cancelTask(id: string): Promise<void> {
  try {
    await executorClient().cancelTask(id);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) return;
    throw err;
  }
}
