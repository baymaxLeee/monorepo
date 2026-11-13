import { createInternalOpenApiClient, TransportError, type InternalOpenApiClient } from "./http.js";
import type { components, paths } from "./schema/knowledge.js";

type KnowledgeDocumentSchema = components["schemas"]["Document"];
export type KnowledgeDocument = Omit<KnowledgeDocumentSchema, "conversation_id" | "source_mime_type"> & {
  conversation_id: string | null;
  source_mime_type: string | null;
};
export type DocumentSlice = components["schemas"]["DocumentSlice"];
export type RetrieveResult = components["schemas"]["RetrieveResult"];
export type RetrievedChunk = components["schemas"]["RetrievedChunk"];
export type StagedMedia = components["schemas"]["StagedMedia"];
export type CleanupConversationArtifactsResult = components["schemas"]["CleanupConversationArtifactsResult"];

export interface KnowledgeClientOptions {
  baseUrl: string;
  internalToken: string;
  callerService: string;
  timeoutMs?: number;
  propagatedHeaders?: () => Record<string, string> | undefined;
}

export class KnowledgeInternalClient {
  private readonly client: InternalOpenApiClient<paths>;

  constructor(options: KnowledgeClientOptions) {
    this.client = createInternalOpenApiClient<paths>({ ...options, service: "knowledge" });
  }

  forkConversationDocuments(input: {
    sourceConversationId: string;
    conversationId: string;
    userId: string;
    tenantId: string;
    workspaceId: string;
  }): Promise<components["schemas"]["ForkConversationDocumentsResult"]> {
    return this.unwrap(
      this.client.POST("/internal/conversation-forks", {
        body: {
          source_conversation_id: input.sourceConversationId,
          conversation_id: input.conversationId,
          user_id: input.userId,
          tenant_id: input.tenantId,
          workspace_id: input.workspaceId,
        },
      }),
    );
  }

  listDocuments(input: { userId: string; conversationId?: string }): Promise<KnowledgeDocument[]> {
    return this.unwrap(
      this.client.GET("/internal/documents", {
        params: { query: { user_id: input.userId, conversation_id: input.conversationId } },
      }),
      (documents) => documents.map(normalizeDocument),
    );
  }

  getDocument(input: { userId: string; documentId: string; includeContent?: boolean }): Promise<KnowledgeDocument> {
    return this.unwrap(
      this.client.GET("/internal/documents/{document_id}", {
        params: {
          path: { document_id: input.documentId },
          query: { user_id: input.userId, include_content: input.includeContent },
        },
      }),
      normalizeDocument,
    );
  }

  async deleteDocument(input: { userId: string; documentId: string }): Promise<void> {
    await this.unwrap(
      this.client.DELETE("/internal/documents/{document_id}", {
        params: { path: { document_id: input.documentId }, query: { user_id: input.userId } },
      }),
    );
  }

  getWorkspaceDocument(input: {
    tenantId: string;
    workspaceId: string;
    documentId: string;
    includeContent?: boolean;
  }): Promise<KnowledgeDocument> {
    return this.unwrap(
      this.client.GET("/internal/workspaces/{workspace_id}/documents/{document_id}", {
        params: {
          path: { workspace_id: input.workspaceId, document_id: input.documentId },
          query: { tenant_id: input.tenantId, include_content: input.includeContent },
        },
      }),
      normalizeDocument,
    );
  }

  getDocumentSlice(input: {
    userId: string;
    documentId: string;
    start?: number;
    maxChars?: number;
    waitMs?: number;
  }): Promise<DocumentSlice> {
    return this.unwrap(
      this.client.GET("/internal/documents/{document_id}/slice", {
        params: {
          path: { document_id: input.documentId },
          query: {
            user_id: input.userId,
            start: input.start ?? 0,
            max_chars: input.maxChars ?? 4000,
            wait_ms: input.waitMs ?? 0,
          },
        },
      }),
    );
  }

  createMediaDocument(input: {
    userId: string;
    tenantId: string;
    workspaceId: string;
    conversationId?: string;
    title: string;
    assetId: string;
    revisionId: string;
    idempotencyKey?: string;
  }): Promise<KnowledgeDocument> {
    return this.unwrap(
      this.client.POST("/internal/media-documents", {
        body: {
          user_id: input.userId,
          tenant_id: input.tenantId,
          workspace_id: input.workspaceId,
          conversation_id: input.conversationId,
          title: input.title,
          asset_id: input.assetId,
          revision_id: input.revisionId,
          idempotency_key: input.idempotencyKey,
        },
      }),
      normalizeDocument,
    );
  }

  createStagedMedia(input: {
    userId: string;
    tenantId: string;
    workspaceId: string;
    conversationId?: string;
    title: string;
    assetId: string;
    revisionId: string;
    idempotencyKey?: string;
  }): Promise<StagedMedia> {
    return this.unwrap(
      this.client.POST("/internal/staged-media", {
        body: {
          user_id: input.userId,
          tenant_id: input.tenantId,
          workspace_id: input.workspaceId,
          conversation_id: input.conversationId,
          title: input.title,
          asset_id: input.assetId,
          revision_id: input.revisionId,
          idempotency_key: input.idempotencyKey,
        },
      }),
    );
  }

  getStagedMedia(input: { userId: string; stagedId: string }): Promise<StagedMedia> {
    return this.unwrap(
      this.client.GET("/internal/staged-media/{staged_id}", {
        params: { path: { staged_id: input.stagedId }, query: { user_id: input.userId } },
      }),
    );
  }

  publishStagedMedia(input: {
    userId: string;
    tenantId: string;
    workspaceId: string;
    stagedId: string;
  }): Promise<KnowledgeDocument> {
    return this.unwrap(
      this.client.POST("/internal/staged-media/{staged_id}/publish", {
        params: { path: { staged_id: input.stagedId } },
        body: { user_id: input.userId, tenant_id: input.tenantId, workspace_id: input.workspaceId },
      }),
      normalizeDocument,
    );
  }

  discardStagedMedia(input: {
    userId: string;
    tenantId: string;
    workspaceId: string;
    stagedId: string;
  }): Promise<StagedMedia> {
    return this.unwrap(
      this.client.POST("/internal/staged-media/{staged_id}/discard", {
        params: { path: { staged_id: input.stagedId } },
        body: { user_id: input.userId, tenant_id: input.tenantId, workspace_id: input.workspaceId },
      }),
    );
  }

  updateArtifact(input: {
    userId: string;
    documentId: string;
    title?: string;
    filename?: string;
    content?: string;
    mimeType?: string;
    expectedUpdatedAt?: string;
  }): Promise<KnowledgeDocument> {
    return this.unwrap(
      this.client.PATCH("/internal/documents/{document_id}", {
        params: { path: { document_id: input.documentId } },
        body: {
          user_id: input.userId,
          title: input.title,
          filename: input.filename,
          content: input.content,
          mime_type: input.mimeType,
          expected_updated_at: input.expectedUpdatedAt,
        },
      }),
      normalizeDocument,
    );
  }

  cleanupConversationArtifacts(input: {
    userId: string;
    tenantId: string;
    workspaceId: string;
    conversationId: string;
  }): Promise<CleanupConversationArtifactsResult> {
    return this.unwrap(
      this.client.POST("/internal/conversation-artifact-cleanups", {
        body: {
          user_id: input.userId,
          tenant_id: input.tenantId,
          workspace_id: input.workspaceId,
          conversation_id: input.conversationId,
        },
      }),
    );
  }

  /**
   * Hybrid RAG retrieval (dense + BM25 + RRF + optional rerank), scoped to the
   * caller's team workspace so members share one knowledge base. `userId` still
   * selects the embedding/rerank provider config. Returns chunks with their
   * source document for citation.
   */
  retrieve(input: {
    userId: string;
    tenantId: string;
    workspaceId: string;
    query: string;
    topK?: number;
    signal?: AbortSignal;
  }): Promise<RetrieveResult> {
    return this.unwrap(
      this.client.POST("/internal/retrieve", {
        body: {
          user_id: input.userId,
          tenant_id: input.tenantId,
          workspace_id: input.workspaceId,
          query: input.query,
          top_k: input.topK,
        },
        signal: input.signal,
      }),
    );
  }

  private async unwrap<T, R = T>(
    promise: Promise<{ data?: T; error?: unknown; response: Response }>,
    map?: (data: T) => R,
  ): Promise<R> {
    const { data, error, response } = await promise;
    if (data) {
      return map ? map(data) : (data as unknown as R);
    }
    throw toTransportError(response, error);
  }
}

function normalizeDocument(document: KnowledgeDocumentSchema): KnowledgeDocument {
  return {
    ...document,
    conversation_id: document.conversation_id ?? null,
    source_mime_type: document.source_mime_type ?? null,
  };
}

function toTransportError(response: Response, error: unknown): TransportError {
  return new TransportError("knowledge", response.status, `knowledge request failed: ${response.status}`, error);
}
