import {
  KnowledgeInternalClient,
  TransportError,
  type DocumentSlice,
  type ArtifactBlockPlan,
  type ArtifactGeneration,
  type KnowledgeDocument,
  type PublishedArtifactRevision,
  type StoredArtifactBlock,
  type ArtifactRevisionWorkspace,
} from "@backend/transport-ts";
import { getSettings } from "../config.js";
import { NotFoundError } from "../lib/errors.js";

export type { DocumentSlice, KnowledgeDocument } from "@backend/transport-ts";
export type {
  ArtifactBlockPlan,
  ArtifactGeneration,
  ArtifactGenerationDetail,
  ArtifactRevisionWorkspace,
  ClaimableArtifactJob,
  PublishedArtifactRevision,
  StoredArtifactBlock,
} from "@backend/transport-ts";

function knowledgeClient(): KnowledgeInternalClient {
  const s = getSettings();
  return new KnowledgeInternalClient({
    baseUrl: s.knowledgeServiceUrl,
    internalToken: s.internalApiToken,
  });
}

export async function listDocuments(
  userId: string,
  conversationId?: string,
): Promise<KnowledgeDocument[]> {
  return knowledgeClient().listDocuments({ userId, conversationId });
}

export async function getDocument(userId: string, documentId: string): Promise<KnowledgeDocument> {
  try {
    return await knowledgeClient().getDocument({ userId, documentId });
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
): Promise<DocumentSlice> {
  try {
    return await knowledgeClient().getDocumentSlice({ userId, documentId, start, maxChars });
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
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  try {
    const source = await knowledgeClient().getDocumentSource({ userId, documentId });
    return { bytes: source.bytes, mimeType: source.contentType };
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new NotFoundError(`document ${documentId} source not found`);
    }
    throw err;
  }
}

export async function createArtifact(input: {
  userId: string;
  conversationId: string;
  title: string;
  filename: string;
  content: string;
  mimeType?: string;
  idempotencyKey?: string;
}): Promise<KnowledgeDocument> {
  return knowledgeClient().createArtifact(input);
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

export async function reserveArtifactGeneration(input: {
  userId: string;
  conversationId: string;
  title: string;
  filename: string;
  mode: "document" | "presentation" | "dashboard";
  brief: string;
  idempotencyKey: string;
  baseRevisionId?: string;
  documentId?: string;
  runId?: string;
  toolCallId?: string;
  resumeGenerationId?: string;
}): Promise<ArtifactGeneration> {
  return knowledgeClient().reserveArtifactGeneration(input);
}

export async function getLatestArtifactWorkspace(
  userId: string,
  documentId: string,
): Promise<ArtifactRevisionWorkspace> {
  return knowledgeClient().getLatestArtifactWorkspace({ userId, documentId });
}

export async function claimArtifactGeneration(input: { userId: string; generationId: string; owner: string }) {
  return knowledgeClient().claimArtifactGeneration(input);
}

export async function renewArtifactGeneration(input: { userId: string; generationId: string; owner: string }) {
  return knowledgeClient().renewArtifactGeneration(input);
}

export async function cancelArtifactGeneration(input: { userId: string; generationId: string; owner?: string }) {
  return knowledgeClient().cancelArtifactGeneration(input);
}

export async function failArtifactGeneration(input: { userId: string; generationId: string; owner?: string; error?: string }) {
  return knowledgeClient().failArtifactGeneration(input);
}

export async function listUnfinishedArtifactGenerations(input: { userId: string; conversationId?: string; runId?: string }) {
  return knowledgeClient().listUnfinishedArtifactGenerations(input);
}

export async function listClaimableArtifactGenerations(input: { limit?: number } = {}) {
  return knowledgeClient().listClaimableArtifactGenerations(input);
}

export async function updateArtifactGenerationPhase(input: {
  userId: string;
  generationId: string;
  owner: string;
  phase: string;
}) {
  return knowledgeClient().updateArtifactGenerationPhase(input);
}

export async function getArtifactGeneration(
  userId: string,
  generationId: string,
): Promise<import("@backend/transport-ts").ArtifactGenerationDetail> {
  return knowledgeClient().getArtifactGeneration({ userId, generationId });
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
  generationId: string;
  compiledHtml: string;
}): Promise<PublishedArtifactRevision> {
  return knowledgeClient().publishArtifactRevision(input);
}
