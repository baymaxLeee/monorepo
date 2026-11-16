import { propagationHeaders } from "@backend/kernel-ts";
import {
  RuntimeWorkerClient,
  TransportError,
  type ProductionDecision,
  type CreateTaskInput,
  type Task,
  type VideoProductionDetail,
  type VideoProductionProjection,
} from "@backend/transport-ts";

import { NotFoundError } from "../../application/errors.js";
import { getServerSettings } from "../../bootstrap/server-config.js";

export type { Task } from "@backend/transport-ts";
export type { ProductionDecision, VideoProductionDetail, VideoProductionProjection } from "@backend/transport-ts";

function workerClient(): RuntimeWorkerClient {
  const s = getServerSettings();
  return new RuntimeWorkerClient({
    baseUrl: s.workerServiceUrl,
    internalToken: s.internalApiToken,
    callerService: "runtime",
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

export async function getVideoProduction(id: string): Promise<VideoProductionDetail> {
  try {
    return await workerClient().getVideoProduction(id);
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
  return workerClient().decideVideoProduction(id, decision);
}
