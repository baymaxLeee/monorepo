import { InnerApiCaller, InnerApiError, insecureChannelCredentials } from "@backend/inner-api/client";
import {
  ConversationDocumentServiceClient,
  type Document as ProtoDocument,
  DocumentKind,
  DocumentServiceClient,
  DocumentSliceState,
  type ForkDocumentsResponse,
  type GetDocumentSliceResponse,
  IndexStatus,
  IngestStatus,
  RetrievalServiceClient,
  type RetrieveResponse,
  StagedMediaServiceClient,
  StagedMediaStatus,
  type StagedMedia as ProtoStagedMedia,
} from "@backend/inner-api/gen/knowledge/v1/knowledge";

import { propagationHeaders } from "#runtime/foundation";

import { NotFoundError } from "../../application/errors.js";
import { getServerSettings } from "../../config/server.js";
import { storageClient } from "./storage.js";

export interface KnowledgeDocument {
  id: string;
  user_id: string;
  workspace_id?: string | null;
  tenant_id?: string | null;
  conversation_id: string | null;
  kind: "source" | "artifact";
  title: string;
  filename: string;
  mime_type: string;
  editable_source: boolean;
  content_md: string;
  source_size: number;
  source_mime_type: string | null;
  asset_id?: string | null;
  source_revision_id?: string | null;
  source_sha256?: string | null;
  source_filename?: string | null;
  ingest_status: string;
  ingest_progress: number;
  ingest_error?: string | null;
  index_status: string;
  index_error?: string | null;
  created_at: string;
  updated_at: string;
}
export interface DocumentSlice {
  id: string;
  title: string;
  filename: string;
  mime_type: string;
  content: string;
  start: number;
  total_chars: number;
  next_start?: number;
  state: "ready" | "processing" | "failed";
  error?: string;
}
export interface RetrievedChunk {
  document_id: string;
  chunk_index: number;
  content: string;
  score: number;
  title: string;
  filename: string;
  media_type: string;
}
export interface RetrieveResult {
  query: string;
  chunks: RetrievedChunk[];
  note?: string;
}
export interface StagedMedia {
  id: string;
  user_id: string;
  workspace_id: string;
  tenant_id: string;
  conversation_id?: string;
  title: string;
  filename: string;
  mime_type: string;
  size: number;
  asset_id: string;
  revision_id: string;
  sha256: string;
  status: "staged" | "published" | "discarded";
  document_id?: string;
  created_at: string;
  updated_at: string;
}

export class KnowledgeRpcClient {
  private readonly caller: InnerApiCaller;
  private readonly documents: DocumentServiceClient;
  private readonly staged: StagedMediaServiceClient;
  private readonly conversations: ConversationDocumentServiceClient;
  private readonly retrieval: RetrievalServiceClient;

  constructor(target: string, timeoutMs = 15_000) {
    this.caller = new InnerApiCaller("runtime", timeoutMs);
    this.documents = new DocumentServiceClient(target, insecureChannelCredentials);
    this.staged = new StagedMediaServiceClient(target, insecureChannelCredentials);
    this.conversations = new ConversationDocumentServiceClient(target, insecureChannelCredentials);
    this.retrieval = new RetrievalServiceClient(target, insecureChannelCredentials);
  }

  private options(timeoutMs?: number, signal?: AbortSignal) {
    return { headers: propagationHeaders(), ...(timeoutMs ? { timeoutMs } : {}), ...(signal ? { signal } : {}) };
  }
  private actor(userId: string, tenantId = "", workspaceId = "") {
    return { userId, tenantId, workspaceId };
  }

  async listDocuments(input: { userId: string; conversationId?: string }): Promise<KnowledgeDocument[]> {
    const response = await this.caller.unary<{ documents: ProtoDocument[] }>(
      (metadata, options, callback) =>
        this.documents.listDocuments(
          { actor: this.actor(input.userId), conversationId: input.conversationId, kind: undefined },
          metadata,
          options,
          callback,
        ),
      this.options(),
    );
    return response.documents.map(document);
  }
  async getDocument(input: { userId: string; documentId: string }): Promise<KnowledgeDocument> {
    const response = await this.caller.unary<{ document?: ProtoDocument }>(
      (metadata, options, callback) =>
        this.documents.getDocument(
          { actor: this.actor(input.userId), documentId: input.documentId },
          metadata,
          options,
          callback,
        ),
      this.options(),
    );
    if (!response.document) throw new Error("knowledge returned no document");
    return document(response.document);
  }
  async deleteDocument(input: { userId: string; documentId: string }): Promise<void> {
    await this.caller.unary(
      (metadata, options, callback) =>
        this.documents.deleteDocument(
          { actor: this.actor(input.userId), documentId: input.documentId },
          metadata,
          options,
          callback,
        ),
      this.options(),
    );
  }
  async getWorkspaceDocument(input: {
    tenantId: string;
    workspaceId: string;
    documentId: string;
  }): Promise<KnowledgeDocument> {
    const response = await this.caller.unary<{ document?: ProtoDocument }>(
      (metadata, options, callback) =>
        this.documents.getWorkspaceDocument(
          { actor: this.actor("", input.tenantId, input.workspaceId), documentId: input.documentId },
          metadata,
          options,
          callback,
        ),
      this.options(),
    );
    if (!response.document) throw new Error("knowledge returned no document");
    return document(response.document);
  }
  async getDocumentSlice(input: {
    userId: string;
    documentId: string;
    start?: number;
    maxChars?: number;
    waitMs?: number;
  }): Promise<DocumentSlice> {
    const response = await this.caller.unary<GetDocumentSliceResponse>(
      (metadata, options, callback) =>
        this.documents.getDocumentSlice(
          {
            actor: this.actor(input.userId),
            documentId: input.documentId,
            start: input.start ?? 0,
            maxChars: input.maxChars ?? 4000,
            waitMillis: input.waitMs ?? 0,
          },
          metadata,
          options,
          callback,
        ),
      this.options((input.waitMs ?? 0) + 5000),
    );
    const value = response.slice;
    if (!value) throw new Error("knowledge returned no document slice");
    return {
      id: value.id,
      title: value.title,
      filename: value.filename,
      mime_type: value.mimeType,
      content: value.content,
      start: value.start,
      total_chars: value.totalChars,
      next_start: value.nextStart,
      state: sliceState(value.state),
      error: value.error,
    };
  }
  async createMediaDocument(input: MediaInput): Promise<KnowledgeDocument> {
    const response = await this.caller.unary<{ document?: ProtoDocument }>(
      (metadata, options, callback) =>
        this.documents.createMediaDocument(
          {
            actor: this.actor(input.userId, input.tenantId, input.workspaceId),
            conversationId: input.conversationId,
            title: input.title,
            assetId: input.assetId,
            revisionId: input.revisionId,
            idempotencyKey: input.idempotencyKey,
          },
          metadata,
          options,
          callback,
        ),
      this.options(180_000),
    );
    if (!response.document) throw new Error("knowledge returned no document");
    return document(response.document);
  }
  async updateArtifact(input: {
    userId: string;
    documentId: string;
    title?: string;
    filename?: string;
    content?: string;
    mimeType?: string;
    expectedUpdatedAt?: string;
  }): Promise<KnowledgeDocument> {
    const response = await this.caller.unary<{ document?: ProtoDocument }>(
      (metadata, options, callback) =>
        this.documents.updateArtifact(
          {
            actor: this.actor(input.userId),
            documentId: input.documentId,
            title: input.title,
            filename: input.filename,
            content: input.content,
            mimeType: input.mimeType,
            expectedUpdatedAt: input.expectedUpdatedAt,
          },
          metadata,
          options,
          callback,
        ),
      this.options(),
    );
    if (!response.document) throw new Error("knowledge returned no document");
    return document(response.document);
  }
  async createStagedMedia(input: MediaInput): Promise<StagedMedia> {
    const response = await this.caller.unary<{ stagedMedia?: ProtoStagedMedia }>(
      (m, o, c) =>
        this.staged.createStagedMedia(
          {
            actor: this.actor(input.userId, input.tenantId, input.workspaceId),
            conversationId: input.conversationId,
            title: input.title,
            assetId: input.assetId,
            revisionId: input.revisionId,
            idempotencyKey: input.idempotencyKey,
          },
          m,
          o,
          c,
        ),
      this.options(180_000),
    );
    if (!response.stagedMedia) throw new Error("knowledge returned no staged media");
    return staged(response.stagedMedia);
  }
  async getStagedMedia(input: { userId: string; stagedId: string }): Promise<StagedMedia> {
    const response = await this.caller.unary<{ stagedMedia?: ProtoStagedMedia }>(
      (m, o, c) =>
        this.staged.getStagedMedia({ actor: this.actor(input.userId), stagedMediaId: input.stagedId }, m, o, c),
      this.options(),
    );
    if (!response.stagedMedia) throw new Error("knowledge returned no staged media");
    return staged(response.stagedMedia);
  }
  async publishStagedMedia(input: StagedAction): Promise<KnowledgeDocument> {
    const response = await this.caller.unary<{ document?: ProtoDocument }>(
      (m, o, c) =>
        this.staged.publishStagedMedia(
          { actor: this.actor(input.userId, input.tenantId, input.workspaceId), stagedMediaId: input.stagedId },
          m,
          o,
          c,
        ),
      this.options(180_000),
    );
    if (!response.document) throw new Error("knowledge returned no document");
    return document(response.document);
  }
  async discardStagedMedia(input: StagedAction): Promise<StagedMedia> {
    const response = await this.caller.unary<{ stagedMedia?: ProtoStagedMedia }>(
      (m, o, c) =>
        this.staged.discardStagedMedia(
          { actor: this.actor(input.userId, input.tenantId, input.workspaceId), stagedMediaId: input.stagedId },
          m,
          o,
          c,
        ),
      this.options(180_000),
    );
    if (!response.stagedMedia) throw new Error("knowledge returned no staged media");
    return staged(response.stagedMedia);
  }
  async cleanupConversationArtifacts(input: {
    userId: string;
    tenantId: string;
    workspaceId: string;
    conversationId: string;
  }): Promise<void> {
    await this.caller.unary(
      (m, o, c) =>
        this.conversations.cleanupArtifacts(
          { actor: this.actor(input.userId, input.tenantId, input.workspaceId), conversationId: input.conversationId },
          m,
          o,
          c,
        ),
      this.options(),
    );
  }
  async forkConversationDocuments(input: {
    sourceConversationId: string;
    conversationId: string;
    userId: string;
    tenantId: string;
    workspaceId: string;
  }): Promise<ForkDocumentsResponse> {
    return this.caller.unary(
      (m, o, c) =>
        this.conversations.forkDocuments(
          {
            actor: this.actor(input.userId, input.tenantId, input.workspaceId),
            sourceConversationId: input.sourceConversationId,
            conversationId: input.conversationId,
          },
          m,
          o,
          c,
        ),
      this.options(),
    );
  }
  async retrieve(input: {
    userId: string;
    tenantId: string;
    workspaceId: string;
    query: string;
    topK?: number;
    signal?: AbortSignal;
  }): Promise<RetrieveResult> {
    const response = await this.caller.unary<RetrieveResponse>(
      (m, o, c) =>
        this.retrieval.retrieve(
          { actor: this.actor(input.userId, input.tenantId, input.workspaceId), query: input.query, topK: input.topK },
          m,
          o,
          c,
        ),
      this.options(undefined, input.signal),
    );
    return {
      query: response.query,
      chunks: response.chunks.map((item) => ({
        document_id: item.documentId,
        chunk_index: item.chunkIndex,
        content: item.content,
        score: item.score,
        title: item.title,
        filename: item.filename,
        media_type: item.mediaType,
      })),
      note: response.note,
    };
  }
}

interface MediaInput {
  userId: string;
  tenantId: string;
  workspaceId: string;
  conversationId?: string;
  title: string;
  assetId: string;
  revisionId: string;
  idempotencyKey?: string;
}
interface StagedAction {
  userId: string;
  tenantId: string;
  workspaceId: string;
  stagedId: string;
}
const enumName = (value: number, values: Record<number, string>) => values[value] ?? "";
function document(value: ProtoDocument): KnowledgeDocument {
  return {
    id: value.id,
    user_id: value.userId,
    workspace_id: value.workspaceId,
    tenant_id: value.tenantId,
    conversation_id: value.conversationId ?? null,
    kind: value.kind === DocumentKind.DOCUMENT_KIND_ARTIFACT ? "artifact" : "source",
    title: value.title,
    filename: value.filename,
    mime_type: value.mimeType,
    editable_source: value.editableSource,
    content_md: value.contentMarkdown,
    source_size: value.sourceSize,
    source_mime_type: value.sourceMimeType ?? null,
    asset_id: value.assetId,
    source_revision_id: value.sourceRevisionId,
    source_sha256: value.sourceSha256,
    source_filename: value.sourceFilename,
    ingest_status: enumName(value.ingestStatus, {
      [IngestStatus.INGEST_STATUS_PENDING]: "pending",
      [IngestStatus.INGEST_STATUS_STORING]: "storing",
      [IngestStatus.INGEST_STATUS_RECEIVED]: "received",
      [IngestStatus.INGEST_STATUS_CONVERTING]: "converting",
      [IngestStatus.INGEST_STATUS_READY]: "ready",
      [IngestStatus.INGEST_STATUS_FAILED]: "failed",
    }),
    ingest_progress: value.ingestProgress,
    ingest_error: value.ingestError,
    index_status: enumName(value.indexStatus, {
      [IndexStatus.INDEX_STATUS_PENDING]: "pending",
      [IndexStatus.INDEX_STATUS_INDEXING]: "indexing",
      [IndexStatus.INDEX_STATUS_INDEXED]: "indexed",
      [IndexStatus.INDEX_STATUS_SKIPPED]: "skipped",
      [IndexStatus.INDEX_STATUS_FAILED]: "failed",
    }),
    index_error: value.indexError,
    created_at: value.createdAt ?? "",
    updated_at: value.updatedAt ?? "",
  };
}
function stagedStatus(value: StagedMediaStatus): StagedMedia["status"] {
  switch (value) {
    case StagedMediaStatus.STAGED_MEDIA_STATUS_PUBLISHED:
      return "published";
    case StagedMediaStatus.STAGED_MEDIA_STATUS_DISCARDED:
      return "discarded";
    default:
      return "staged";
  }
}
function staged(value: ProtoStagedMedia): StagedMedia {
  return {
    id: value.id,
    user_id: value.userId,
    workspace_id: value.workspaceId,
    tenant_id: value.tenantId,
    conversation_id: value.conversationId,
    title: value.title,
    filename: value.filename,
    mime_type: value.mimeType,
    size: value.size,
    asset_id: value.assetId,
    revision_id: value.revisionId,
    sha256: value.sha256,
    status: stagedStatus(value.status),
    document_id: value.documentId,
    created_at: value.createdAt ?? "",
    updated_at: value.updatedAt ?? "",
  };
}
function sliceState(value: DocumentSliceState): DocumentSlice["state"] {
  switch (value) {
    case DocumentSliceState.DOCUMENT_SLICE_STATE_READY:
      return "ready";
    case DocumentSliceState.DOCUMENT_SLICE_STATE_FAILED:
      return "failed";
    default:
      return "processing";
  }
}

function client(timeoutMs?: number) {
  return new KnowledgeRpcClient(getServerSettings().knowledgeRpcTarget, timeoutMs);
}
export const knowledgeDocumentSessionId = (value: KnowledgeDocument) => value.conversation_id;
export const listDocuments = (userId: string, sessionId?: string) =>
  client().listDocuments({ userId, conversationId: sessionId });
export async function cleanupSessionArtifacts(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  sessionId: string;
}) {
  await client().cleanupConversationArtifacts({ ...input, conversationId: input.sessionId });
}
export async function getDocument(
  userId: string,
  documentId: string,
  _includeContent = true,
): Promise<KnowledgeDocument> {
  try {
    return await client().getDocument({ userId, documentId });
  } catch (error) {
    if (error instanceof InnerApiError && error.code === 5) throw new NotFoundError(`document ${documentId} not found`);
    throw error;
  }
}
export async function getWorkspaceDocument(
  tenantId: string,
  workspaceId: string,
  documentId: string,
): Promise<KnowledgeDocument> {
  try {
    return await client().getWorkspaceDocument({ tenantId, workspaceId, documentId });
  } catch (error) {
    if (error instanceof InnerApiError && error.code === 5) throw new NotFoundError(`document ${documentId} not found`);
    throw error;
  }
}
export async function getDocumentSlice(userId: string, documentId: string, start = 0, maxChars = 4000, waitMs = 0) {
  return client(waitMs + 5000).getDocumentSlice({ userId, documentId, start, maxChars, waitMs });
}
export async function getDocumentSource(
  userId: string,
  documentId: string,
  options?: { maxDim?: number; sessionId?: string; signal?: AbortSignal },
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  options?.signal?.throwIfAborted();
  const doc = await getDocument(userId, documentId);
  if (options?.sessionId && doc.conversation_id !== options.sessionId)
    throw new NotFoundError(`document ${documentId} does not belong to the session`);
  if (!doc.asset_id || !doc.source_revision_id || !doc.tenant_id || !doc.workspace_id)
    throw new NotFoundError(`document ${documentId} has no Storage revision`);
  const stream = await storageClient().content({
    tenantId: doc.tenant_id,
    workspaceId: doc.workspace_id,
    assetId: doc.asset_id,
    revisionId: doc.source_revision_id,
    maxDim: options?.maxDim,
    signal: options?.signal,
  });
  const buffer = await new Response(stream).arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    mimeType: options?.maxDim ? "image/jpeg" : doc.source_mime_type || doc.mime_type,
  };
}
export async function getStagedMediaDelivery(userId: string, stagedId: string) {
  const media = await client().getStagedMedia({ userId, stagedId });
  if (media.status === "discarded") throw new NotFoundError("staged media was discarded");
  return storageClient().mintDelivery({
    tenantId: media.tenant_id,
    workspaceId: media.workspace_id,
    assetId: media.asset_id,
    revisionId: media.revision_id,
  });
}
export const retrieveKnowledge = (
  userId: string,
  tenantId: string,
  workspaceId: string,
  query: string,
  topK?: number,
  signal?: AbortSignal,
) => client().retrieve({ userId, tenantId, workspaceId, query, topK, signal });
export const createMediaDocument = (input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  sessionId: string;
  title: string;
  assetId: string;
  revisionId: string;
  idempotencyKey?: string;
}) => {
  const { sessionId, ...rest } = input;
  return client(180_000).createMediaDocument({ ...rest, conversationId: sessionId });
};
export const updateArtifact = (input: {
  userId: string;
  documentId: string;
  title?: string;
  filename?: string;
  content?: string;
  mimeType?: string;
  expectedUpdatedAt?: string;
}) => client().updateArtifact(input);
export async function forkSessionDocuments(input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  sourceSessionId: string;
  sessionId: string;
}) {
  const response = await client().forkConversationDocuments({
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    sourceConversationId: input.sourceSessionId,
    conversationId: input.sessionId,
  });
  return { document_ids: response.documentIds };
}
