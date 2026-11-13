import { propagationHeaders } from "@backend/kernel-ts";
import {
  ExecutorInternalClient,
  TransportError,
  type ProductionDecision,
  type CreateTaskInput,
  type Task,
  type VideoProductionDetail,
  type VideoProductionProjection,
} from "@backend/transport-ts";

import { NotFoundError } from "../../application/errors.js";
import { getSettings } from "../../bootstrap/config.js";

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

type StartTaskInput = {
  [Type in CreateTaskInput["type"]]: {
    type: Type;
    ownerRef: string;
    payload: Extract<CreateTaskInput, { type: Type }>["payload"];
  };
}[CreateTaskInput["type"]];

export async function startTask(input: StartTaskInput): Promise<Task> {
  if (input.type === "image-generation") {
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
