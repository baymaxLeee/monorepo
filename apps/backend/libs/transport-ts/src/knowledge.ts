import {
  createInternalOpenApiClient,
  TransportError,
  type BinaryResponse,
  type InternalOpenApiClient,
} from "./http.js";
import type { components, paths } from "./schema/knowledge.js";

type KnowledgeDocumentSchema = components["schemas"]["Document"];
export type KnowledgeDocument = Omit<
  KnowledgeDocumentSchema,
  "conversation_id" | "source_mime_type"
> & {
  conversation_id: string | null;
  source_mime_type: string | null;
};
export type DocumentSlice = components["schemas"]["DocumentSlice"];
export type ArtifactGeneration = components["schemas"]["ArtifactGeneration"];
export type ArtifactBlockPlan = components["schemas"]["ArtifactBlockPlan"];
export type PublishedArtifactRevision = components["schemas"]["PublishedArtifactRevision"];
export type StoredArtifactBlock = components["schemas"]["StoredArtifactBlock"];

export interface KnowledgeClientOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs?: number;
}

export class KnowledgeInternalClient {
  private readonly client: InternalOpenApiClient<paths>;

  constructor(options: KnowledgeClientOptions) {
    this.client = createInternalOpenApiClient<paths>({ ...options, service: "knowledge" });
  }

  listDocuments(input: {
    userId: string;
    conversationId?: string;
  }): Promise<KnowledgeDocument[]> {
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

  getDocumentSlice(input: {
    userId: string;
    documentId: string;
    start?: number;
    maxChars?: number;
  }): Promise<DocumentSlice> {
    return this.unwrap(
      this.client.GET("/internal/documents/{document_id}/slice", {
        params: {
          path: { document_id: input.documentId },
          query: {
            user_id: input.userId,
            start: input.start ?? 0,
            max_chars: input.maxChars ?? 4000,
          },
        },
      }),
    );
  }

  async getDocumentSource(input: { userId: string; documentId: string }): Promise<BinaryResponse> {
    const { data, error, response } = await this.client.GET(
      "/internal/documents/{document_id}/source",
      {
        params: { path: { document_id: input.documentId }, query: { user_id: input.userId } },
        parseAs: "arrayBuffer",
      },
    );
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

  reserveArtifactGeneration(input: {
    userId: string;
    conversationId?: string;
    title: string;
    filename: string;
    mode: "document" | "presentation" | "dashboard";
    brief: string;
    idempotencyKey: string;
    baseRevisionId?: string;
  }): Promise<ArtifactGeneration> {
    return this.unwrap(
      this.client.POST("/internal/artifact-generations", {
        body: {
          user_id: input.userId,
          conversation_id: input.conversationId,
          title: input.title,
          filename: input.filename,
          mode: input.mode,
          brief: input.brief,
          idempotency_key: input.idempotencyKey,
          base_revision_id: input.baseRevisionId,
        },
      }),
    );
  }

  getArtifactGeneration(input: {
    userId: string;
    generationId: string;
  }): Promise<ArtifactGeneration> {
    return this.unwrap(
      this.client.GET("/internal/artifact-generations/{generation_id}", {
        params: {
          path: { generation_id: input.generationId },
          query: { user_id: input.userId },
        },
      }),
    );
  }

  saveArtifactPlan(input: {
    userId: string;
    generationId: string;
    manifest: Record<string, unknown>;
    blocks: ArtifactBlockPlan[];
  }): Promise<ArtifactGeneration> {
    return this.unwrap(
      this.client.PUT("/internal/artifact-generations/{generation_id}/plan", {
        params: { path: { generation_id: input.generationId } },
        body: { user_id: input.userId, manifest: input.manifest, blocks: input.blocks },
      }),
    );
  }

  saveArtifactBlock(input: {
    userId: string;
    generationId: string;
    blockId: string;
    content: string;
  }): Promise<ArtifactGeneration> {
    return this.unwrap(
      this.client.PUT("/internal/artifact-generations/{generation_id}/blocks/{block_id}", {
        params: { path: { generation_id: input.generationId, block_id: input.blockId } },
        body: { user_id: input.userId, content: input.content },
      }),
    );
  }

  listArtifactBlocks(input: {
    userId: string;
    generationId: string;
  }): Promise<StoredArtifactBlock[]> {
    return this.unwrap(
      this.client.GET("/internal/artifact-generations/{generation_id}/blocks", {
        params: {
          path: { generation_id: input.generationId },
          query: { user_id: input.userId },
        },
      }),
    );
  }

  publishArtifactRevision(input: {
    userId: string;
    generationId: string;
    compiledHtml: string;
  }): Promise<PublishedArtifactRevision> {
    return this.unwrap(
      this.client.POST("/internal/artifact-generations/{generation_id}/publish", {
        params: { path: { generation_id: input.generationId } },
        body: { user_id: input.userId, compiled_html: input.compiledHtml },
      }),
    );
  }

  private async unwrap<T, R = T>(
    promise: Promise<{ data?: T; error?: unknown; response: Response }>,
    map?: (data: T) => R,
  ): Promise<R> {
    const { data, error, response } = await promise;
    if (data) return map ? map(data) : (data as unknown as R);
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
  return new TransportError(
    "knowledge",
    response.status,
    `knowledge request failed: ${response.status}`,
    error,
  );
}
