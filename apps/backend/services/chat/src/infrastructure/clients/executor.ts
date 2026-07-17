import { ExecutorInternalClient, TransportError, type Task } from "@backend/transport-ts";
import { propagationHeaders } from "@backend/kernel-ts";

import { getSettings } from "../../bootstrap/config.js";
import { NotFoundError } from "../../application/errors.js";

export type { Task } from "@backend/transport-ts";

function executorClient(): ExecutorInternalClient {
  const s = getSettings();
  return new ExecutorInternalClient({
    baseUrl: s.executorServiceUrl,
    internalToken: s.internalApiToken,
    callerService: "chat",
    propagatedHeaders: propagationHeaders,
  });
}

function executorValidationClient(): ExecutorInternalClient {
  const s = getSettings();
  return new ExecutorInternalClient({
    baseUrl: s.executorServiceUrl,
    internalToken: s.internalApiToken,
    callerService: "chat",
    timeoutMs: 30 * 60_000,
    propagatedHeaders: propagationHeaders,
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

export async function validateHtml(input: { userId: string; orgId: string; providerId: string; documentId: string; signal?: AbortSignal }) {
  return executorValidationClient().validateHtml({
    user_id: input.userId,
    org_id: input.orgId,
    provider_id: input.providerId,
    document_id: input.documentId,
    signal: input.signal,
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
