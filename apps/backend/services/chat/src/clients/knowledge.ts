import { getSettings } from "../config.js";
import { NotFoundError } from "../lib/errors.js";

export interface KnowledgeDocument {
  id: string;
  user_id: string;
  conversation_id: string | null;
  kind: "source" | "artifact";
  title: string;
  filename: string;
  mime_type: string;
  content_md?: string;
  source_size: number;
  source_mime_type: string | null;
  object_bucket?: string | null;
  object_key?: string | null;
  object_sha256?: string | null;
  source_filename?: string | null;
  ingest_status: string;
  ingest_progress: number;
  ingest_error?: string | null;
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
  next_start: number | null;
}

function internalHeaders(): HeadersInit {
  const s = getSettings();
  return { "X-Internal-Token": s.internalApiToken };
}

function knowledgeBase(): string {
  return getSettings().knowledgeServiceUrl.replace(/\/$/, "");
}

export async function listDocuments(
  userId: string,
  conversationId?: string,
): Promise<KnowledgeDocument[]> {
  const params = new URLSearchParams({ user_id: userId });
  if (conversationId) params.set("conversation_id", conversationId);
  const res = await fetch(`${knowledgeBase()}/internal/documents?${params}`, {
    headers: internalHeaders(),
  });
  if (!res.ok) throw new Error(`knowledge list failed: ${res.status}`);
  return (await res.json()) as KnowledgeDocument[];
}

export async function getDocument(userId: string, documentId: string): Promise<KnowledgeDocument> {
  const params = new URLSearchParams({ user_id: userId });
  const res = await fetch(`${knowledgeBase()}/internal/documents/${documentId}?${params}`, {
    headers: internalHeaders(),
  });
  if (res.status === 404) throw new NotFoundError(`document ${documentId} not found`);
  if (!res.ok) throw new Error(`knowledge get failed: ${res.status}`);
  return (await res.json()) as KnowledgeDocument;
}

export async function getDocumentSlice(
  userId: string,
  documentId: string,
  start = 0,
  maxChars = 4000,
): Promise<DocumentSlice> {
  const params = new URLSearchParams({
    user_id: userId,
    start: String(start),
    max_chars: String(maxChars),
  });
  const res = await fetch(
    `${knowledgeBase()}/internal/documents/${documentId}/slice?${params}`,
    { headers: internalHeaders() },
  );
  if (res.status === 404) throw new NotFoundError(`document ${documentId} not found`);
  if (!res.ok) throw new Error(`knowledge slice failed: ${res.status}`);
  return (await res.json()) as DocumentSlice;
}

export async function getDocumentSource(
  userId: string,
  documentId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const params = new URLSearchParams({ user_id: userId });
  const res = await fetch(
    `${knowledgeBase()}/internal/documents/${documentId}/source?${params}`,
    { headers: internalHeaders() },
  );
  if (res.status === 404) throw new NotFoundError(`document ${documentId} source not found`);
  if (!res.ok) throw new Error(`knowledge source failed: ${res.status}`);
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, mimeType };
}

export async function createArtifact(input: {
  userId: string;
  conversationId: string;
  title: string;
  filename: string;
  content: string;
  mimeType?: string;
}): Promise<KnowledgeDocument> {
  const res = await fetch(`${knowledgeBase()}/internal/artifacts`, {
    method: "POST",
    headers: { ...internalHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: input.userId,
      conversation_id: input.conversationId,
      title: input.title,
      filename: input.filename,
      content: input.content,
      mime_type: input.mimeType,
    }),
  });
  if (!res.ok) throw new Error(`knowledge create artifact failed: ${res.status}`);
  return (await res.json()) as KnowledgeDocument;
}
