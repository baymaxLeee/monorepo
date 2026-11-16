import {
  KnowledgeInternalClient,
  TransportError,
  type KnowledgeDocument,
  type StagedMedia,
} from "@backend/transport-ts";

import { getWorkerSettings } from "../../config/worker.js";

export type { KnowledgeDocument, StagedMedia } from "@backend/transport-ts";

function knowledgeClient(timeoutMs?: number): KnowledgeInternalClient {
  const settings = getWorkerSettings();
  return new KnowledgeInternalClient({
    baseUrl: settings.knowledgeServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "runtime",
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

export async function getDocument(userId: string, documentId: string): Promise<KnowledgeDocument> {
  return knowledgeClient().getDocument({ userId, documentId });
}

export async function deleteDocument(userId: string, documentId: string): Promise<void> {
  try {
    await knowledgeClient().deleteDocument({ userId, documentId });
  } catch (error) {
    if (error instanceof TransportError && error.status === 404) return;
    throw error;
  }
}

export function createMediaDocument(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  sessionId?: string;
  title: string;
  assetId: string;
  revisionId: string;
  idempotencyKey?: string;
}): Promise<KnowledgeDocument> {
  const { sessionId, ...rest } = input;
  return knowledgeClient(180_000).createMediaDocument({
    ...rest,
    conversationId: sessionId,
  });
}

export function createStagedMedia(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  sessionId?: string;
  title: string;
  assetId: string;
  revisionId: string;
  idempotencyKey?: string;
}): Promise<StagedMedia> {
  const { sessionId, ...rest } = input;
  return knowledgeClient(180_000).createStagedMedia({
    ...rest,
    conversationId: sessionId,
  });
}

export function publishStagedMedia(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  stagedId: string;
}): Promise<KnowledgeDocument> {
  return knowledgeClient(180_000).publishStagedMedia(input);
}

export function discardStagedMedia(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  stagedId: string;
}): Promise<StagedMedia> {
  return knowledgeClient(180_000).discardStagedMedia(input);
}
