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
    source_object_bucket: (doc.object_bucket as string | null) ?? null,
    source_object_key: (doc.object_key as string | null) ?? null,
    source_sha256: (doc.object_sha256 as string | null) ?? null,
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

function buildIngestForm(
  files: Array<{ clientRef: string; file: File }>,
  options?: { conversationId?: string; providerId?: string | null },
): FormData {
  const form = new FormData();
  const clientRefs: string[] = [];
  for (const item of files) {
    form.append("files", item.file);
    clientRefs.push(item.clientRef);
  }
  form.append("client_refs", JSON.stringify(clientRefs));
  if (options?.conversationId) {
    form.append("conversation_id", options.conversationId);
  }
  if (options?.providerId) {
    form.append("provider_id", options.providerId);
  }
  return form;
}

async function postIngest(form: FormData, conversationId: string): Promise<IngestResult> {
  const response = await authFetch(`${API_BASE_URL}${BASE}/ingest`, {
    method: "POST",
    body: form,
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
  return postIngest(
    buildIngestForm(files, {
      conversationId,
      providerId: ingestOptions?.providerId,
    }),
    conversationId,
  );
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
  return postIngest(buildIngestForm(files, { providerId: ingestOptions?.providerId }), "");
}

export type { ConversationDocumentDetail };
