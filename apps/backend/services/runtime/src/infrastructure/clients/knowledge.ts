import { propagationHeaders } from "@backend/kernel-ts";
import {
  KnowledgeInternalClient,
  TransportError,
  type DocumentSlice,
  type KnowledgeDocument,
  type RetrieveResult,
} from "@backend/transport-ts";

import { NotFoundError } from "../../application/errors.js";
import { getServerSettings } from "../../config/server.js";
import { storageClient } from "./storage.js";

export type { DocumentSlice, KnowledgeDocument, RetrieveResult } from "@backend/transport-ts";

export function knowledgeDocumentSessionId(document: KnowledgeDocument): string | null {
  return document.conversation_id ?? null;
}

function knowledgeClient(timeoutMs?: number): KnowledgeInternalClient {
  const s = getServerSettings();
  return new KnowledgeInternalClient({
    baseUrl: s.knowledgeServiceUrl,
    internalToken: s.internalApiToken,
    callerService: "runtime",
    propagatedHeaders: propagationHeaders,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

export async function listDocuments(userId: string, sessionId?: string): Promise<KnowledgeDocument[]> {
  return knowledgeClient().listDocuments({ userId, conversationId: sessionId });
}

export async function cleanupSessionArtifacts(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  sessionId: string;
}): Promise<void> {
  await knowledgeClient().cleanupConversationArtifacts({
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: input.sessionId,
  });
}

export async function getDocument(
  userId: string,
  documentId: string,
  includeContent = true,
): Promise<KnowledgeDocument> {
  try {
    return await knowledgeClient().getDocument({ userId, documentId, includeContent });
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new NotFoundError(`document ${documentId} not found`);
    }
    throw err;
  }
}

export async function getWorkspaceDocument(
  tenantId: string,
  workspaceId: string,
  documentId: string,
): Promise<KnowledgeDocument> {
  try {
    return await knowledgeClient().getWorkspaceDocument({ tenantId, workspaceId, documentId, includeContent: false });
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new NotFoundError(`document ${documentId} not found`);
    }
    throw err;
  }
}

export async function getDocumentSlice(
  userId: string,
  documentId: string,
  start = 0,
  maxChars = 4000,
  waitMs = 0,
): Promise<DocumentSlice> {
  // The long-poll holds the request open for up to waitMs; the transport's
  // default 15s abort would kill it, so give the client headroom past waitMs.
  const client = knowledgeClient(waitMs > 0 ? waitMs + 5000 : undefined);
  try {
    return await client.getDocumentSlice({ userId, documentId, start, maxChars, waitMs });
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new NotFoundError(`document ${documentId} not found`);
    }
    throw err;
  }
}

export async function getDocumentSource(
  userId: string,
  documentId: string,
  options?: { maxDim?: number; sessionId?: string; signal?: AbortSignal },
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  options?.signal?.throwIfAborted();
  const doc = await knowledgeClient().getDocument({ userId, documentId });
  if (options?.sessionId && doc.conversation_id !== options.sessionId) {
    throw new NotFoundError(`document ${documentId} does not belong to the session`);
  }
  if (!doc.asset_id || !doc.source_revision_id || !doc.tenant_id || !doc.workspace_id) {
    throw new NotFoundError(`document ${documentId} has no Storage revision`);
  }
  const stream = await storageClient().content({
    tenantId: doc.tenant_id,
    workspaceId: doc.workspace_id,
    assetId: doc.asset_id,
    revisionId: doc.source_revision_id,
    maxDim: options?.maxDim,
    signal: options?.signal,
  });
  return {
    bytes: new Uint8Array(await new Response(stream).arrayBuffer()),
    mimeType: options?.maxDim ? "image/jpeg" : doc.source_mime_type || doc.mime_type,
  };
}

export async function getStagedMediaDelivery(
  userId: string,
  stagedId: string,
): Promise<{ url: string; expires_at: string }> {
  const media = await knowledgeClient().getStagedMedia({ userId, stagedId });
  if (media.status === "discarded") throw new NotFoundError("staged media was discarded");
  return storageClient().mintDelivery({
    tenantId: media.tenant_id,
    workspaceId: media.workspace_id,
    assetId: media.asset_id,
    revisionId: media.revision_id,
  });
}

export async function retrieveKnowledge(
  userId: string,
  tenantId: string,
  workspaceId: string,
  query: string,
  topK?: number,
  signal?: AbortSignal,
): Promise<RetrieveResult> {
  return knowledgeClient().retrieve({ userId, tenantId, workspaceId, query, topK, signal });
}

export async function createMediaDocument(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  sessionId: string;
  title: string;
  assetId: string;
  revisionId: string;
  idempotencyKey?: string;
}): Promise<KnowledgeDocument> {
  return knowledgeClient().createMediaDocument({
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: input.sessionId,
    title: input.title,
    assetId: input.assetId,
    revisionId: input.revisionId,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function updateArtifact(input: {
  userId: string;
  documentId: string;
  title?: string;
  filename?: string;
  content?: string;
  mimeType?: string;
  expectedUpdatedAt?: string;
}): Promise<KnowledgeDocument> {
  try {
    return await knowledgeClient().updateArtifact(input);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new NotFoundError(`artifact ${input.documentId} not found`);
    }
    throw err;
  }
}

export function forkSessionDocuments(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  sourceSessionId: string;
  sessionId: string;
}) {
  return knowledgeClient().forkConversationDocuments({
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    sourceConversationId: input.sourceSessionId,
    conversationId: input.sessionId,
  });
}
