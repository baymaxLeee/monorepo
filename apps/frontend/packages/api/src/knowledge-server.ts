import { executeAssetUploadPlan, type AssetUploadPlan } from "./asset-server";
import { authFetch } from "./auth-fetch";
import type {
  ConversationDocument,
  ConversationDocumentDetail,
  ConversationDocumentKind,
  UpdateConversationDocumentInput,
} from "./chat-server";
import { API_BASE_URL, type ApiRequestConfig, apiHttp, request } from "./http";

const BASE = "/api/knowledge-server";
type RequestOptions = Pick<ApiRequestConfig, "skipErrorNotify">;

export type KnowledgeDocument = Omit<ConversationDocument, "conversation_id"> & {
  user_id?: string;
  conversation_id?: string | null;
};

export interface IngestFailure {
  index: number;
  client_ref: string;
  artifact_id?: string | null;
  error: string;
  code?: string | null;
}

export interface IngestResult {
  documents: Array<{
    index: number;
    client_ref: string;
    document: ConversationDocumentDetail;
  }>;
  failed: IngestFailure[];
}

/** Map knowledge document payload to chat ConversationDocument shape for UI reuse. */
export function toConversationDocument(doc: Record<string, unknown>, conversationId: string): ConversationDocument {
  return {
    id: String(doc.id),
    conversation_id: String(doc.conversation_id ?? conversationId),
    kind: (doc.kind as ConversationDocument["kind"]) ?? "source",
    title: String(doc.title),
    filename: String(doc.filename),
    mime_type: String(doc.mime_type),
    source_size: Number(doc.source_size ?? 0),
    source_mime_type: (doc.source_mime_type as string | null) ?? null,
    asset_id: (doc.asset_id as string | null) ?? null,
    source_revision_id: (doc.source_revision_id as string | null) ?? null,
    source_sha256: (doc.source_sha256 as string | null) ?? null,
    source_filename: (doc.source_filename as string | null) ?? null,
    ingest_status: (doc.ingest_status as ConversationDocument["ingest_status"]) ?? "ready",
    ingest_progress: Number(doc.ingest_progress ?? 100),
    ingest_error: (doc.ingest_error as string | null) ?? null,
    index_status: (doc.index_status as ConversationDocument["index_status"]) ?? "skipped",
    index_error: (doc.index_error as string | null) ?? null,
    created_at: String(doc.created_at),
    updated_at: String(doc.updated_at),
  };
}

async function ingestFiles(
  files: Array<{ clientRef: string; file: File }>,
  conversationId: string,
  providerId?: string | null,
): Promise<IngestResult> {
  const prepareResponse = await authFetch(`${API_BASE_URL}${BASE}/ingest:prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: files.map(({ clientRef, file }) => ({
        client_ref: clientRef,
        filename: file.name,
        media_type: file.type || "application/octet-stream",
        size_bytes: file.size,
      })),
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  });
  if (!prepareResponse.ok) {
    throw new Error(`upload preparation failed: ${prepareResponse.status}`);
  }
  const prepared = (await prepareResponse.json()) as {
    uploads: Array<{
      client_ref: string;
      upload_session_id: string;
      intent_id: string;
      state: AssetUploadPlan["state"];
      upload_url: string;
      expires_at: string;
      asset_id?: string | null;
      revision_id?: string | null;
    }>;
  };
  const filesByClientRef = new Map(files.map((item) => [item.clientRef, item.file]));
  await Promise.all(
    prepared.uploads.map((upload) => {
      const file = filesByClientRef.get(upload.client_ref);
      if (!file) throw new Error(`upload plan returned unknown client_ref ${upload.client_ref}`);
      return executeAssetUploadPlan(
        {
          uploadSessionId: upload.upload_session_id,
          intentId: upload.intent_id,
          state: upload.state,
          uploadUrl: upload.upload_url,
          expiresAt: upload.expires_at,
          filename: file.name,
          mediaType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          assetId: upload.asset_id,
          revisionId: upload.revision_id,
        },
        file,
      );
    }),
  );
  const response = await authFetch(`${API_BASE_URL}${BASE}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploads: prepared.uploads.map((upload) => ({
        client_ref: upload.client_ref,
        upload_session_id: upload.upload_session_id,
      })),
      ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(providerId ? { provider_id: providerId } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`ingest failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    documents?: Array<{
      index: number;
      client_ref: string;
      document: Record<string, unknown>;
    }>;
    failed?: IngestFailure[];
  };
  return {
    documents: (payload.documents ?? []).map((receipt) => ({
      index: receipt.index,
      client_ref: receipt.client_ref,
      document: {
        ...toConversationDocument(receipt.document, String(receipt.document.conversation_id ?? conversationId)),
        content_md: String(receipt.document.content_md ?? ""),
      },
    })),
    failed: payload.failed ?? [],
  };
}

export async function ingestConversationDocuments(
  conversationId: string,
  files: Array<{ clientRef: string; file: File }>,
  ingestOptions?: { providerId?: string | null },
): Promise<IngestResult> {
  return ingestFiles(files, conversationId, ingestOptions?.providerId);
}

export async function fetchKnowledgeDocument(documentId: string): Promise<ConversationDocumentDetail> {
  const doc = await request<Record<string, unknown>>({
    url: `${BASE}/documents/${encodeURIComponent(documentId)}`,
    method: "GET",
  });
  return {
    ...toConversationDocument(doc, String(doc.conversation_id ?? "")),
    content_md: String(doc.content_md ?? ""),
  };
}

export async function updateKnowledgeDocument(
  documentId: string,
  input: UpdateConversationDocumentInput,
): Promise<ConversationDocumentDetail> {
  const doc = await request<Record<string, unknown>>({
    url: `${BASE}/documents/${encodeURIComponent(documentId)}`,
    method: "PATCH",
    data: input,
  });
  return {
    ...toConversationDocument(doc, String(doc.conversation_id ?? "")),
    content_md: String(doc.content_md ?? ""),
  };
}

/**
 * List the current user's knowledge-base documents. Defaults to `source`
 * (operator-uploaded enterprise docs) so agent-generated artifacts don't leak
 * into the management view.
 */
export async function listKnowledgeDocuments(
  params?: {
    kind?: ConversationDocumentKind;
  },
  options?: RequestOptions,
): Promise<KnowledgeDocument[]> {
  const query = params?.kind ? `?kind=${encodeURIComponent(params.kind)}` : "";
  const docs = await request<Array<Record<string, unknown>>>({
    url: `${BASE}/documents${query}`,
    method: "GET",
    ...options,
  });
  return docs.map((doc) => ({
    ...toConversationDocument(doc, String(doc.conversation_id ?? "")),
    user_id: doc.user_id ? String(doc.user_id) : undefined,
    conversation_id: (doc.conversation_id as string | null) ?? null,
  }));
}

/** Re-queue a document for background RAG indexing (retry skipped/failed). */
export async function reindexKnowledgeDocument(documentId: string): Promise<KnowledgeDocument> {
  const doc = await request<Record<string, unknown>>({
    url: `${BASE}/documents/${encodeURIComponent(documentId)}/reindex`,
    method: "POST",
  });
  return {
    ...toConversationDocument(doc, String(doc.conversation_id ?? "")),
    user_id: doc.user_id ? String(doc.user_id) : undefined,
    conversation_id: (doc.conversation_id as string | null) ?? null,
  };
}

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  await request<void>({
    url: `${BASE}/documents/${encodeURIComponent(documentId)}`,
    method: "DELETE",
  });
}

export interface BatchDeleteKnowledgeResult {
  requested: number;
  deleted: number;
}

export async function batchDeleteKnowledgeDocuments(ids: string[]): Promise<BatchDeleteKnowledgeResult> {
  return request<BatchDeleteKnowledgeResult>({
    url: `${BASE}/documents/batch-delete`,
    method: "POST",
    data: { ids },
  });
}

export function knowledgeDocumentSourceUrl(documentId: string): string {
  return `${API_BASE_URL}${BASE}/documents/${encodeURIComponent(documentId)}/source`;
}

export interface KnowledgeDocumentResourceURL {
  url: string;
  expires_at: string;
  mime_type: string;
  filename: string;
}

export async function createKnowledgeDocumentResourceUrl(documentId: string): Promise<KnowledgeDocumentResourceURL> {
  const resource = await request<KnowledgeDocumentResourceURL>({
    url: `${BASE}/documents/${encodeURIComponent(documentId)}/resource-url`,
    method: "POST",
  });
  return {
    ...resource,
    url: new URL(resource.url, API_BASE_URL || window.location.origin).toString(),
  };
}

export async function createKnowledgeFileResourceUrl(
  conversationId: string,
  path: string,
): Promise<KnowledgeDocumentResourceURL> {
  const resource = await request<KnowledgeDocumentResourceURL>({
    url: `${BASE}/files/resource-url`,
    method: "POST",
    data: {
      conversation_id: conversationId,
      path,
    },
  });
  return {
    ...resource,
    url: new URL(resource.url, API_BASE_URL || window.location.origin).toString(),
  };
}

export function isMediaConversationDocument(document: ConversationDocument): boolean {
  const mime = (document.source_mime_type || document.mime_type || "").toLowerCase();
  return mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/");
}

export async function fetchKnowledgeDocumentSource(documentId: string): Promise<Blob> {
  const response = await apiHttp.get<Blob>(`${BASE}/documents/${encodeURIComponent(documentId)}/source`, {
    responseType: "blob",
  });
  return response.data;
}

/**
 * Upload one or more files into the knowledge base (no conversation scope).
 * The request returns once bytes are stored + referenceable. MarkItDown/vision
 * conversion and RAG indexing both run in the background afterwards; track them
 * via `ingest_status` (received -> converting -> ready) and `index_status`.
 */
export async function ingestKnowledgeDocuments(
  files: Array<{ clientRef: string; file: File }>,
  ingestOptions?: { providerId?: string | null },
): Promise<IngestResult> {
  return ingestFiles(files, "", ingestOptions?.providerId);
}

export function assetRevisionContentUrl(assetId: string, revisionId: string, documentId?: string): string {
  const path = `${API_BASE_URL}/api/asset-server/assets/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revisionId)}/content`;
  return documentId ? `${path}?document_id=${encodeURIComponent(documentId)}` : path;
}

export type { ConversationDocumentDetail };
