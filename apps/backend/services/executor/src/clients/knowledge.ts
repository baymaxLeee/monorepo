import {
  KnowledgeInternalClient,
  type ArtifactBlockPlan,
  type ArtifactGeneration,
  type ArtifactRevisionWorkspace,
  type KnowledgeDocument,
  type PublishedArtifactRevision,
  type StoredArtifactBlock,
} from "@backend/transport-ts";

import { getSettings } from "../config.js";

export type {
  ArtifactBlockPlan,
  ArtifactGeneration,
  ArtifactRevisionWorkspace,
  KnowledgeDocument,
  PublishedArtifactRevision,
  StoredArtifactBlock,
} from "@backend/transport-ts";

function knowledgeClient(): KnowledgeInternalClient {
  const s = getSettings();
  return new KnowledgeInternalClient({
    baseUrl: s.knowledgeServiceUrl,
    internalToken: s.internalApiToken,
    callerService: "executor",
  });
}

const MEDIA_UPLOAD_TIMEOUT_MS = 180_000;

function knowledgeMediaClient(): KnowledgeInternalClient {
  const s = getSettings();
  return new KnowledgeInternalClient({
    baseUrl: s.knowledgeServiceUrl,
    internalToken: s.internalApiToken,
    callerService: "executor",
    timeoutMs: MEDIA_UPLOAD_TIMEOUT_MS,
  });
}

export async function getDocument(userId: string, documentId: string): Promise<KnowledgeDocument> {
  return knowledgeClient().getDocument({ userId, documentId });
}

export async function getDocumentSource(
  userId: string,
  documentId: string,
  options?: { maxDim?: number },
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const source = await knowledgeClient().getDocumentSource({
    userId,
    documentId,
    maxDim: options?.maxDim,
  });
  return { bytes: source.bytes, mimeType: source.contentType };
}

export async function createMediaDocument(input: {
  userId: string;
  orgId: string;
  conversationId?: string;
  title: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  idempotencyKey?: string;
}): Promise<KnowledgeDocument> {
  return knowledgeMediaClient().createMediaDocument(input);
}

export async function getLatestArtifactWorkspace(
  userId: string,
  documentId: string,
): Promise<ArtifactRevisionWorkspace> {
  return knowledgeClient().getLatestArtifactWorkspace({ userId, documentId });
}


export async function reserveArtifactGeneration(input: {
  userId: string;
  orgId: string;
  conversationId?: string;
  title: string;
  filename: string;
  mode: "document" | "presentation" | "dashboard";
  brief: string;
  idempotencyKey: string;
  documentId?: string;
}): Promise<ArtifactGeneration> {
  return knowledgeClient().reserveArtifactGeneration(input);
}

export async function saveArtifactPlan(input: {
  userId: string;
  generationId: string;
  manifest: Record<string, unknown>;
  blocks: ArtifactBlockPlan[];
}): Promise<ArtifactGeneration> {
  return knowledgeClient().saveArtifactPlan(input);
}

export async function saveArtifactBlock(input: {
  userId: string;
  generationId: string;
  blockId: string;
  content: string;
  failed?: boolean;
}): Promise<ArtifactGeneration> {
  return knowledgeClient().saveArtifactBlock(input);
}

export async function listArtifactBlocks(
  userId: string,
  generationId: string,
): Promise<StoredArtifactBlock[]> {
  return knowledgeClient().listArtifactBlocks({ userId, generationId });
}

export async function publishArtifactRevision(input: {
  userId: string;
  orgId: string;
  generationId: string;
  compiledHtml: string;
}): Promise<PublishedArtifactRevision> {
  return knowledgeClient().publishArtifactRevision(input);
}

export async function failArtifactGeneration(input: {
  userId: string;
  generationId: string;
  error?: string;
}): Promise<ArtifactGeneration> {
  return knowledgeClient().failArtifactGeneration(input);
}

export async function cancelArtifactGeneration(input: {
  userId: string;
  generationId: string;
}): Promise<ArtifactGeneration> {
  return knowledgeClient().cancelArtifactGeneration(input);
}
