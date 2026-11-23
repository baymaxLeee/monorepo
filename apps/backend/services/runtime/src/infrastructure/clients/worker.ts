import { propagationHeaders } from "#runtime/foundation";
import { RuntimeWorkerClient, type CreateTaskInput, type Task } from "#runtime/transport";

import { getServerSettings } from "../../config/server.js";

export type { Task } from "#runtime/transport";

function workerClient(): RuntimeWorkerClient {
  const s = getServerSettings();
  return new RuntimeWorkerClient({
    baseUrl: s.workerServiceUrl,
    internalToken: s.internalApiToken,
    callerService: "runtime",
    propagatedHeaders: propagationHeaders,
  });
}

type StartTaskInput =
  | {
      type: "image-generation";
      ownerRef: string;
      payload: Extract<CreateTaskInput, { type: "image-generation" }>["payload"];
    }
  | {
      type: "video-generation";
      ownerRef: string;
      payload: Extract<CreateTaskInput, { type: "video-generation" }>["payload"];
    };

export async function startTask(input: StartTaskInput): Promise<Task> {
  if (input.type === "image-generation") {
    return workerClient().startTask({
      type: input.type,
      owner_service: "runtime",
      owner_ref: input.ownerRef,
      payload: input.payload,
    });
  }
  return workerClient().startTask({
    type: input.type,
    owner_service: "runtime",
    owner_ref: input.ownerRef,
    payload: input.payload,
  });
}

export async function getTask(id: string, ownerRef: string): Promise<Task> {
  return workerClient().getTask(id, { owner_service: "runtime", owner_ref: ownerRef });
}

export function watchTask(id: string, ownerRef: string, signal?: AbortSignal) {
  return workerClient().watchTask(id, { owner_service: "runtime", owner_ref: ownerRef }, signal);
}
