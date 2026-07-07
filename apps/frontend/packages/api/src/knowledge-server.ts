import { authFetch } from "./auth-fetch";
import type {
  ConversationDocument,
  ConversationDocumentDetail,
  ConversationDocumentKind,
  DocumentIngestStreamEvent,
  StreamEventOptions,
  UpdateConversationDocumentInput,
} from "./chat-server";
import { API_BASE_URL, type ApiRequestConfig, apiHttp, request } from "./http";

const BASE = "/api/knowledge-server";
type RequestOptions = Pick<ApiRequestConfig, "skipErrorNotify">;

export type KnowledgeDocument = Omit<
  ConversationDocument,
  "conversation_id"
> & {
  user_id?: string;
  conversation_id?: string | null;
};

export type { DocumentIngestStreamEvent };

async function openKnowledgeIngestStream(
  url: string,
  form: FormData,
  options: StreamEventOptions<DocumentIngestStreamEvent>,
): Promise<void> {
  const { onEvent, signal } = options;
  const response = await authFetch(url, {
    method: "POST",
    headers: { Accept: "text/event-stream" },
    body: form,
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`ingest stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const dataLines = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length > 0) {
          const data = dataLines.join("\n");
          if (data === "[DONE]") return;
          onEvent(JSON.parse(data) as DocumentIngestStreamEvent);
        }
        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Map knowledge document payload to chat ConversationDocument shape for UI reuse. */
export function toConversationDocument(
  doc: Record<string, unknown>,
  conversationId: string,
): ConversationDocument {
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
    ingest_status:
      (doc.ingest_status as ConversationDocument["ingest_status"]) ?? "ready",
    ingest_progress: Number(doc.ingest_progress ?? 100),
    ingest_error: (doc.ingest_error as string | null) ?? null,
    created_at: String(doc.created_at),
    updated_at: String(doc.updated_at),
  };
}

export async function streamKnowledgeIngest(
  conversationId: string,
  files: Array<{ clientRef: string; file: File }>,
  options: StreamEventOptions<DocumentIngestStreamEvent>,
  ingestOptions?: { providerId?: string | null },
): Promise<void> {
  const form = new FormData();
  const clientRefs: string[] = [];
  for (const item of files) {
    form.append("files", item.file);
    clientRefs.push(item.clientRef);
  }
  form.append("client_refs", JSON.stringify(clientRefs));
  form.append("conversation_id", conversationId);
  if (ingestOptions?.providerId) {
    form.append("provider_id", ingestOptions.providerId);
  }
  const url = `${API_BASE_URL}${BASE}/ingest/stream`;
  await openKnowledgeIngestStream(url, form, options);
}

export async function fetchKnowledgeDocument(
  documentId: string,
): Promise<ConversationDocumentDetail> {
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

export async function deleteKnowledgeDocument(
  documentId: string,
): Promise<void> {
  await request<void>({
    url: `${BASE}/documents/${encodeURIComponent(documentId)}`,
    method: "DELETE",
  });
}

export interface BatchDeleteKnowledgeResult {
  requested: number;
  deleted: number;
}

export async function batchDeleteKnowledgeDocuments(
  ids: string[],
): Promise<BatchDeleteKnowledgeResult> {
  return request<BatchDeleteKnowledgeResult>({
    url: `${BASE}/documents/batch-delete`,
    method: "POST",
    data: { ids },
  });
}

export function knowledgeDocumentSourceUrl(documentId: string): string {
  return `${API_BASE_URL}${BASE}/documents/${encodeURIComponent(documentId)}/source`;
}

export function isMediaConversationDocument(
  document: ConversationDocument,
): boolean {
  const mime = (
    document.source_mime_type ||
    document.mime_type ||
    ""
  ).toLowerCase();
  return (
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/")
  );
}

export async function fetchKnowledgeDocumentSource(
  documentId: string,
): Promise<Blob> {
  const response = await apiHttp.get<Blob>(
    `${BASE}/documents/${encodeURIComponent(documentId)}/source`,
    { responseType: "blob" },
  );
  return response.data;
}

/**
 * Upload one or more files into the knowledge base (no conversation scope).
 * Bytes are stored, converted to markdown, and RAG-indexed server-side;
 * progress streams back via SSE, mirroring the chat ingest flow.
 */
export async function uploadKnowledgeDocuments(
  files: Array<{ clientRef: string; file: File }>,
  options: StreamEventOptions<DocumentIngestStreamEvent>,
  ingestOptions?: { providerId?: string | null },
): Promise<void> {
  const form = new FormData();
  const clientRefs: string[] = [];
  for (const item of files) {
    form.append("files", item.file);
    clientRefs.push(item.clientRef);
  }
  form.append("client_refs", JSON.stringify(clientRefs));
  if (ingestOptions?.providerId) {
    form.append("provider_id", ingestOptions.providerId);
  }
  const url = `${API_BASE_URL}${BASE}/ingest/stream`;
  await openKnowledgeIngestStream(url, form, options);
}

export type { ConversationDocumentDetail };
