import {
  ExecutorInternalClient,
  TransportError,
  type ProductionDecision,
  type CreateTaskInput,
  type Task,
  type VideoProductionDetail,
  type VideoProductionProjection,
} from "@backend/transport-ts";
import { propagationHeaders } from "@backend/kernel-ts";

import { getSettings } from "../../bootstrap/config.js";
import { NotFoundError } from "../../application/errors.js";

export type { Task } from "@backend/transport-ts";
export type { ProductionDecision, VideoProductionDetail, VideoProductionProjection } from "@backend/transport-ts";

function executorClient(): ExecutorInternalClient {
  const s = getSettings();
  return new ExecutorInternalClient({
    baseUrl: s.executorServiceUrl,
    internalToken: s.internalApiToken,
    callerService: "chat",
    propagatedHeaders: propagationHeaders,
  });
}

type StartTaskInput =
  | { type: "file-task-batch"; ownerRef: string; payload: Extract<CreateTaskInput, { type: "file-task-batch" }>["payload"] }
  | { type: "video-generation"; ownerRef: string; payload: Extract<CreateTaskInput, { type: "video-generation" }>["payload"] };

export async function startTask(input: StartTaskInput): Promise<Task> {
  if (input.type === "file-task-batch") {
    return executorClient().startTask({
      type: input.type,
      owner_service: "chat",
      owner_ref: input.ownerRef,
      payload: input.payload,
    });
  }
  return executorClient().startTask({
    type: input.type,
    owner_service: "chat",
    owner_ref: input.ownerRef,
    payload: input.payload,
  });
}

const CHAT_TASK_OWNER = { owner_service: "chat" } as const;

export async function getTask(id: string, ownerRef: string): Promise<Task> {
  try {
    return await executorClient().getTask(id, {
      ...CHAT_TASK_OWNER,
      owner_ref: ownerRef,
    });
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new NotFoundError(`task ${id} not found`);
    }
    throw err;
  }
}

export async function cancelTask(id: string, ownerRef: string): Promise<void> {
  try {
    await executorClient().cancelTask(id, {
      ...CHAT_TASK_OWNER,
      owner_ref: ownerRef,
    });
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) return;
    throw err;
  }
}

export async function getVideoProduction(id: string): Promise<VideoProductionDetail> {
  try {
    return await executorClient().getVideoProduction(id);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new NotFoundError(`video production ${id} not found`);
    }
    throw err;
  }
}

export async function decideVideoProduction(
  id: string,
  decision: ProductionDecision,
): Promise<VideoProductionProjection> {
  return executorClient().decideVideoProduction(id, decision);
}
