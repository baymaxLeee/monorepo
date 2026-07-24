import {
  KnowledgeInternalClient,
  type KnowledgeDocument,
  type StagedMedia,
  type VirtualFileRead,
} from "@backend/transport-ts";

import { getSettings } from "../../bootstrap/config.js";

export type { KnowledgeDocument, StagedMedia, VirtualFileRead } from "@backend/transport-ts";

function knowledgeClient(timeoutMs?: number): KnowledgeInternalClient {
  const settings = getSettings();
  return new KnowledgeInternalClient({
    baseUrl: settings.knowledgeServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "executor",
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

export function readVirtualFile(input: { userId: string; conversationId: string; path: string; offset?: number; limit?: number }): Promise<VirtualFileRead> {
  return knowledgeClient().readVirtualFile(input);
}

export function writeChangeSetFile(input: { userId: string; changeSetId: string; path: string; content: string; mimeType: string; writable?: boolean; derived?: boolean }) {
  return knowledgeClient().writeChangeSetFile(input);
}

export async function getDocument(userId: string, documentId: string): Promise<KnowledgeDocument> {
  return knowledgeClient().getDocument({ userId, documentId });
}

export async function getDocumentSource(userId: string, documentId: string, options?: { maxDim?: number }): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const source = await knowledgeClient().getDocumentSource({ userId, documentId, maxDim: options?.maxDim });
  return { bytes: source.bytes, mimeType: source.contentType };
}

export function createMediaDocument(input: { userId: string; orgId: string; conversationId?: string; title: string; filename: string; mimeType: string; bytes: Uint8Array; idempotencyKey?: string }): Promise<KnowledgeDocument> {
  return knowledgeClient(180_000).createMediaDocument(input);
}

export function createStagedMedia(input: { userId: string; orgId: string; conversationId?: string; title: string; filename: string; mimeType: string; bytes: Uint8Array; idempotencyKey?: string }): Promise<StagedMedia> {
  return knowledgeClient(180_000).createStagedMedia(input);
}

export function publishStagedMedia(input: { userId: string; orgId: string; stagedId: string }): Promise<KnowledgeDocument> {
  return knowledgeClient(180_000).publishStagedMedia(input);
}

export function discardStagedMedia(input: { userId: string; orgId: string; stagedId: string }): Promise<StagedMedia> {
  return knowledgeClient(180_000).discardStagedMedia(input);
}
