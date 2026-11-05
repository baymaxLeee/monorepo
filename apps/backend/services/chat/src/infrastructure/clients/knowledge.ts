import { propagationHeaders } from "@backend/kernel-ts";
import {
  KnowledgeInternalClient,
  TransportError,
  type DocumentSlice,
  type KnowledgeDocument,
  type RetrieveResult,
  type VirtualFileEntry,
  type VirtualFileRead,
  type FileChangeSet,
  type FileSearchMatch,
} from "@backend/transport-ts";

import { NotFoundError } from "../../application/errors.js";
import { getSettings } from "../../bootstrap/config.js";
import { storageClient } from "./storage.js";

export type {
  DocumentSlice,
  KnowledgeDocument,
  RetrieveResult,
  VirtualFileEntry,
  VirtualFileRead,
  FileChangeSet,
  FileSearchMatch,
} from "@backend/transport-ts";

function knowledgeClient(timeoutMs?: number): KnowledgeInternalClient {
  const s = getSettings();
  return new KnowledgeInternalClient({
    baseUrl: s.knowledgeServiceUrl,
    internalToken: s.internalApiToken,
    callerService: "chat",
    propagatedHeaders: propagationHeaders,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

export async function listDocuments(userId: string, conversationId?: string): Promise<KnowledgeDocument[]> {
  return knowledgeClient().listDocuments({ userId, conversationId });
}

export function listVirtualFiles(userId: string, conversationId: string, path?: string): Promise<VirtualFileEntry[]> {
  return knowledgeClient().listVirtualFiles({ userId, conversationId, path });
}

export function readVirtualFile(input: {
  userId: string;
  conversationId: string;
  path: string;
  offset?: number;
  limit?: number;
}): Promise<VirtualFileRead> {
  return knowledgeClient().readVirtualFile(input);
}

export function createFileChangeSet(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  metadata?: Record<string, string>;
}): Promise<FileChangeSet> {
  return knowledgeClient().createFileChangeSet(input);
}

export function writeChangeSetFile(input: {
  userId: string;
  changeSetId: string;
  path: string;
  content: string;
  mimeType: string;
  writable?: boolean;
  derived?: boolean;
}): Promise<VirtualFileEntry> {
  return knowledgeClient().writeChangeSetFile(input);
}

export function listChangeSetFiles(input: { userId: string; changeSetId: string }): Promise<VirtualFileEntry[]> {
  return knowledgeClient().listChangeSetFiles(input);
}

export function readChangeSetFile(input: {
  userId: string;
  changeSetId: string;
  path: string;
  offset?: number;
  limit?: number;
}): Promise<VirtualFileRead> {
  return knowledgeClient().readChangeSetFile(input);
}

export function promoteFileChangeSet(input: { userId: string; changeSetId: string }): Promise<VirtualFileEntry[]> {
  return knowledgeClient().promoteFileChangeSet(input);
}

export function discardFileChangeSet(input: { userId: string; changeSetId: string }): Promise<FileChangeSet> {
  return knowledgeClient().discardFileChangeSet(input);
}

export function searchVirtualFiles(input: {
  userId: string;
  conversationId: string;
  pattern: string;
  path?: string;
  glob?: string;
}): Promise<FileSearchMatch[]> {
  return knowledgeClient().searchVirtualFiles(input);
}

export async function cleanupConversationArtifacts(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
}): Promise<void> {
  await knowledgeClient().cleanupConversationArtifacts(input);
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
  options?: { maxDim?: number },
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const doc = await knowledgeClient().getDocument({ userId, documentId });
  if (!doc.asset_id || !doc.source_revision_id || !doc.tenant_id || !doc.workspace_id) {
    throw new NotFoundError(`document ${documentId} has no Storage revision`);
  }
  const stream = await storageClient().content({
    tenantId: doc.tenant_id,
    workspaceId: doc.workspace_id,
    assetId: doc.asset_id,
    revisionId: doc.source_revision_id,
    maxDim: options?.maxDim,
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

export async function createArtifact(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  title: string;
  filename: string;
  content: string;
  mimeType?: string;
  idempotencyKey?: string;
}): Promise<KnowledgeDocument> {
  return knowledgeClient().createArtifact(input);
}

export async function createMediaDocument(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  title: string;
  assetId: string;
  revisionId: string;
  idempotencyKey?: string;
}): Promise<KnowledgeDocument> {
  return knowledgeClient().createMediaDocument(input);
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
