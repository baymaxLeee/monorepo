import type {
  ConversationDocument,
  ConversationDocumentDetail,
  DocumentIngestStreamEvent,
  StreamEventOptions,
  UpdateConversationDocumentInput,
} from "./chat-server";
import { API_BASE_URL, apiHttp, request } from "./http";

const BASE = "/api/knowledge-server";

export type KnowledgeDocument = ConversationDocument & {
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
  const { getToken, isAccessTokenValid } = await import("./storage");
  const { refreshSession } = await import("./session");

  if (!isAccessTokenValid()) {
    await refreshSession();
  }

  const headers: Record<string, string> = { Accept: "text/event-stream" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers,
    body: form,
    signal,
  });

  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { ...headers, Authorization: `Bearer ${getToken()}` },
        body: form,
        signal,
      });
    }
  }

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
  _conversationId: string,
  documentId: string,
): Promise<ConversationDocumentDetail> {
  const doc = await request<Record<string, unknown>>({
    url: `${BASE}/documents/${documentId}`,
    method: "GET",
  });
  return {
    ...toConversationDocument(
      doc,
      String(doc.conversation_id ?? _conversationId),
    ),
    content_md: String(doc.content_md ?? ""),
  };
}

export async function updateKnowledgeDocument(
  _conversationId: string,
  documentId: string,
  input: UpdateConversationDocumentInput,
): Promise<ConversationDocumentDetail> {
  const doc = await request<Record<string, unknown>>({
    url: `${BASE}/documents/${documentId}`,
    method: "PATCH",
    data: input,
  });
  return {
    ...toConversationDocument(
      doc,
      String(doc.conversation_id ?? _conversationId),
    ),
    content_md: String(doc.content_md ?? ""),
  };
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
  _conversationId: string,
  documentId: string,
): Promise<Blob> {
  const response = await apiHttp.get<Blob>(
    `${BASE}/documents/${encodeURIComponent(documentId)}/source`,
    { responseType: "blob" },
  );
  return response.data;
}

export type { ConversationDocumentDetail };
