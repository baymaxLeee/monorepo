import {
  createInternalOpenApiClient,
  TransportError,
  type BinaryResponse,
  type InternalOpenApiClient,
} from "./http.js";
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
export type VirtualFileEntry = components["schemas"]["FileEntry"];
export type VirtualFileRead = components["schemas"]["FileRead"];
export type FileChangeSet = components["schemas"]["ChangeSet"];
export type FileSearchMatch = components["schemas"]["FileSearchMatch"];
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

  listDocuments(input: { userId: string; conversationId?: string }): Promise<KnowledgeDocument[]> {
    return this.unwrap(
      this.client.GET("/internal/documents", {
        params: { query: { user_id: input.userId, conversation_id: input.conversationId } },
      }),
      (documents) => documents.map(normalizeDocument),
    );
  }

  getDocument(input: { userId: string; documentId: string }): Promise<KnowledgeDocument> {
    return this.unwrap(
      this.client.GET("/internal/documents/{document_id}", {
        params: { path: { document_id: input.documentId }, query: { user_id: input.userId } },
      }),
      normalizeDocument,
    );
  }

  listVirtualFiles(input: { userId: string; conversationId: string; path?: string }): Promise<VirtualFileEntry[]> {
    return this.unwrap(
      this.client.GET("/internal/files", {
        params: { query: { user_id: input.userId, conversation_id: input.conversationId, path: input.path } },
      }),
    );
  }

  readVirtualFile(input: {
    userId: string;
    conversationId: string;
    path: string;
    offset?: number;
    limit?: number;
  }): Promise<VirtualFileRead> {
    return this.unwrap(
      this.client.GET("/internal/files/read", {
        params: {
          query: {
            user_id: input.userId,
            conversation_id: input.conversationId,
            path: input.path,
            offset: input.offset ?? 1,
            limit: input.limit ?? 200,
          },
        },
      }),
    );
  }

  createFileChangeSet(input: {
    userId: string;
    orgId: string;
    conversationId: string;
    metadata?: Record<string, string>;
  }): Promise<FileChangeSet> {
    return this.unwrap(
      this.client.POST("/internal/files/change-sets", {
        body: {
          user_id: input.userId,
          org_id: input.orgId,
          conversation_id: input.conversationId,
          metadata: input.metadata,
        },
      }),
    );
  }

  writeChangeSetFile(input: {
    userId: string;
    changeSetId: string;
    path: string;
    content: string;
    mimeType: string;
    writable?: boolean;
    derived?: boolean;
  }): Promise<VirtualFileEntry> {
    return this.unwrap(
      this.client.PUT("/internal/files/change-sets/{change_set_id}/files", {
        params: { path: { change_set_id: input.changeSetId } },
        body: {
          user_id: input.userId,
          path: input.path,
          content: input.content,
          mime_type: input.mimeType,
          writable: input.writable ?? true,
          derived: input.derived ?? false,
        },
      }),
    );
  }

  listChangeSetFiles(input: { userId: string; changeSetId: string }): Promise<VirtualFileEntry[]> {
    return this.unwrap(
      this.client.GET("/internal/files/change-sets/{change_set_id}/files", {
        params: {
          path: { change_set_id: input.changeSetId },
          query: { user_id: input.userId },
        },
      }),
    );
  }

  readChangeSetFile(input: {
    userId: string;
    changeSetId: string;
    path: string;
    offset?: number;
    limit?: number;
  }): Promise<VirtualFileRead> {
    return this.unwrap(
      this.client.GET("/internal/files/change-sets/{change_set_id}/read", {
        params: {
          path: { change_set_id: input.changeSetId },
          query: { user_id: input.userId, path: input.path, offset: input.offset ?? 1, limit: input.limit ?? 400 },
        },
      }),
    );
  }

  promoteFileChangeSet(input: { userId: string; changeSetId: string }): Promise<VirtualFileEntry[]> {
    return this.unwrap(
      this.client.POST("/internal/files/change-sets/{change_set_id}/promote", {
        params: { path: { change_set_id: input.changeSetId } },
        body: { user_id: input.userId },
      }),
    );
  }

  discardFileChangeSet(input: { userId: string; changeSetId: string }): Promise<FileChangeSet> {
    return this.unwrap(
      this.client.POST("/internal/files/change-sets/{change_set_id}/discard", {
        params: { path: { change_set_id: input.changeSetId } },
        body: { user_id: input.userId },
      }),
    );
  }

  searchVirtualFiles(input: {
    userId: string;
    conversationId: string;
    pattern: string;
    path?: string;
    glob?: string;
  }): Promise<FileSearchMatch[]> {
    return this.unwrap(
      this.client.POST("/internal/files/search", {
        body: {
          user_id: input.userId,
          conversation_id: input.conversationId,
          pattern: input.pattern,
          path: input.path,
          glob: input.glob,
        },
      }),
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

  async getDocumentSource(input: { userId: string; documentId: string; maxDim?: number }): Promise<BinaryResponse> {
    const { data, error, response } = await this.client.GET("/internal/documents/{document_id}/source", {
      params: {
        path: { document_id: input.documentId },
        query: { user_id: input.userId, max_dim: input.maxDim },
      },
      parseAs: "arrayBuffer",
    });
    if (data) {
      const rawMime = response.headers.get("content-type") ?? "application/octet-stream";
      return {
        bytes: new Uint8Array(data),
        contentType: rawMime.split(";")[0]?.trim() || "application/octet-stream",
      };
    }
    throw toTransportError(response, error);
  }

  createArtifact(input: {
    userId: string;
    orgId: string;
    conversationId: string;
    title: string;
    filename: string;
    content: string;
    mimeType?: string;
    idempotencyKey?: string;
  }): Promise<KnowledgeDocument> {
    return this.unwrap(
      this.client.POST("/internal/artifacts", {
        body: {
          user_id: input.userId,
          org_id: input.orgId,
          conversation_id: input.conversationId,
          title: input.title,
          filename: input.filename,
          content: input.content,
          mime_type: input.mimeType,
          idempotency_key: input.idempotencyKey,
        },
      }),
      normalizeDocument,
    );
  }

  /**
   * Persist agent-generated binary media (image/video/audio) as a document.
   * The bytes are copied into knowledge's object store and served back via the
   * existing `/documents/{id}/source` route. Callers must pass raw bytes, never
   * a provider's temporary URL (ADR-0014). Idempotent on `idempotencyKey`.
   */
  createMediaDocument(input: {
    userId: string;
    orgId: string;
    conversationId?: string;
    title: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    idempotencyKey?: string;
  }): Promise<KnowledgeDocument> {
    return this.unwrap(
      this.client.POST("/internal/media-documents", {
        body: {
          user_id: input.userId,
          org_id: input.orgId,
          conversation_id: input.conversationId,
          title: input.title,
          filename: input.filename,
          mime_type: input.mimeType,
          data_base64: base64FromBytes(input.bytes),
          idempotency_key: input.idempotencyKey,
        },
      }),
      normalizeDocument,
    );
  }

  createStagedMedia(input: {
    userId: string;
    orgId: string;
    conversationId?: string;
    title: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
    idempotencyKey?: string;
  }): Promise<StagedMedia> {
    return this.unwrap(
      this.client.POST("/internal/staged-media", {
        body: {
          user_id: input.userId,
          org_id: input.orgId,
          conversation_id: input.conversationId,
          title: input.title,
          filename: input.filename,
          mime_type: input.mimeType,
          data_base64: base64FromBytes(input.bytes),
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

  async getStagedMediaSource(input: { userId: string; stagedId: string }): Promise<BinaryResponse> {
    const { data, error, response } = await this.client.GET("/internal/staged-media/{staged_id}/source", {
      params: { path: { staged_id: input.stagedId }, query: { user_id: input.userId } },
      parseAs: "arrayBuffer",
    });
    if (data) {
      return {
        bytes: new Uint8Array(data),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
      };
    }
    throw toTransportError(response, error);
  }

  publishStagedMedia(input: { userId: string; orgId: string; stagedId: string }): Promise<KnowledgeDocument> {
    return this.unwrap(
      this.client.POST("/internal/staged-media/{staged_id}/publish", {
        params: { path: { staged_id: input.stagedId } },
        body: { user_id: input.userId, org_id: input.orgId },
      }),
      normalizeDocument,
    );
  }

  discardStagedMedia(input: { userId: string; orgId: string; stagedId: string }): Promise<StagedMedia> {
    return this.unwrap(
      this.client.POST("/internal/staged-media/{staged_id}/discard", {
        params: { path: { staged_id: input.stagedId } },
        body: { user_id: input.userId, org_id: input.orgId },
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
    orgId: string;
    conversationId: string;
  }): Promise<CleanupConversationArtifactsResult> {
    return this.unwrap(
      this.client.POST("/internal/conversation-artifact-cleanups", {
        body: {
          user_id: input.userId,
          org_id: input.orgId,
          conversation_id: input.conversationId,
        },
      }),
    );
  }

  /**
   * Hybrid RAG retrieval (dense + BM25 + RRF + optional rerank), scoped to the
   * caller's team org so members share one knowledge base. `userId` still
   * selects the embedding/rerank provider config. Returns chunks with their
   * source document for citation.
   */
  retrieve(input: {
    userId: string;
    orgId: string;
    query: string;
    topK?: number;
    signal?: AbortSignal;
  }): Promise<RetrieveResult> {
    return this.unwrap(
      this.client.POST("/internal/retrieve", {
        body: { user_id: input.userId, org_id: input.orgId, query: input.query, top_k: input.topK },
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

function base64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
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
