import {
  KnowledgeInternalClient,
  TransportError,
  type ArtifactRevisionWorkspace,
  type DocumentSlice,
  type KnowledgeDocument,
  type RetrieveResult,
  type StoredArtifactBlock,
} from "@backend/transport-ts";
import { getSettings } from "../config.js";
import { NotFoundError } from "../lib/errors.js";

export type {
  ArtifactRevisionWorkspace,
  DocumentSlice,
  KnowledgeDocument,
  RetrieveResult,
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

export async function getLatestArtifactWorkspace(
  userId: string,
  documentId: string,
): Promise<ArtifactRevisionWorkspace | null> {
  try {
    return await knowledgeClient().getLatestArtifactWorkspace({ userId, documentId });
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      return null;
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

export async function retrieveKnowledge(
  userId: string,
  query: string,
  topK?: number,
): Promise<RetrieveResult> {
  return knowledgeClient().retrieve({ userId, query, topK });
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

export async function createMediaDocument(input: {
  userId: string;
  conversationId: string;
  title: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
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

