import { API_BASE_URL, request, toApiError } from "./http";
import { refreshSession } from "./session";
import { getToken, isAccessTokenValid } from "./storage";

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "ok" | "streaming" | "failed";
export type ReasoningEffort = "low" | "medium" | "high";

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  model: string;
  provider_id: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
  documents: ConversationDocument[];
}

export interface CreateConversationInput {
  title?: string;
  /** Optionally pin the conversation to a specific admin-configured provider. */
  provider_id?: string | null;
}

export interface UpdateConversationInput {
  title?: string;
}

export type ConversationDocumentKind = "source" | "artifact";

export interface ConversationDocument {
  id: string;
  conversation_id: string;
  kind: ConversationDocumentKind;
  title: string;
  filename: string;
  mime_type: string;
  source_size: number;
  source_mime_type?: string | null;
  source_object_bucket?: string | null;
  source_object_key?: string | null;
  source_sha256?: string | null;
  source_filename?: string | null;
  ingest_status?: IngestStatus;
  ingest_progress?: number;
  ingest_error?: string | null;
  created_at: string;
  updated_at: string;
}

export type IngestStatus =
  | "pending"
  | "queued"
  | "storing"
  | "converting"
  | "ready"
  | "failed";

export interface ConversationDocumentDetail extends ConversationDocument {
  content_md: string;
}

export interface UpdateConversationDocumentInput {
  title?: string;
  content_md?: string;
}

export interface AgentStepEvent {
  type: "step";
  text: string;
  status?: "pending" | "running" | "completed" | "failed";
  tool_name?: string;
  output_preview?: string;
}

export interface AgentMessageEvent {
  type: "message";
  role?: "assistant";
  status?: "streaming" | "completed" | "failed";
  delta?: string;
  text?: string;
}

export interface AgentCardEvent {
  type: "card";
  card: {
    type: "artifact" | "chart";
    document?: ConversationDocument;
    title?: string;
    payload?: unknown;
  };
}

export type AgentRunStreamEvent =
  | AgentMessageEvent
  | AgentStepEvent
  | AgentCardEvent
  | { type: "error"; message: string };

export interface RunConversationAgentInput {
  prompt: string;
  provider_id?: string | null;
  multimodal_provider_id?: string | null;
  document_ids?: string[];
  thinking?: boolean | null;
  reasoning_effort?: ReasoningEffort | null;
}

const BASE = "/api/chat-server/conversations";

export function fetchConversations(): Promise<Conversation[]> {
  return request<Conversation[]>({ url: BASE, method: "GET" });
}

export function fetchConversation(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>({
    url: `${BASE}/${encodeURIComponent(id)}`,
    method: "GET",
  });
}

export function createConversation(
  input: CreateConversationInput = {},
): Promise<Conversation> {
  return request<Conversation>({
    url: BASE,
    method: "POST",
    data: {
      title: input.title ?? "新对话",
      ...(input.provider_id ? { provider_id: input.provider_id } : {}),
    },
  });
}

export function updateConversation(
  id: string,
  input: UpdateConversationInput,
): Promise<Conversation> {
  return request<Conversation>({
    url: `${BASE}/${encodeURIComponent(id)}`,
    method: "PATCH",
    data: input,
  });
}

export function deleteConversation(id: string): Promise<void> {
  return request<void>({
    url: `${BASE}/${encodeURIComponent(id)}`,
    method: "DELETE",
  });
}

export function uploadConversationDocument(
  conversationId: string,
  file: File,
): Promise<ConversationDocumentDetail> {
  const form = new FormData();
  form.append("file", file);
  return request<ConversationDocumentDetail>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/documents`,
    method: "POST",
    data: form,
  });
}

export function fetchConversationDocument(
  conversationId: string,
  documentId: string,
): Promise<ConversationDocumentDetail> {
  return request<ConversationDocumentDetail>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/documents/${encodeURIComponent(documentId)}`,
    method: "GET",
  });
}

export function conversationDocumentSourceUrl(
  conversationId: string,
  documentId: string,
): string {
  return `${API_BASE_URL}${BASE}/${encodeURIComponent(conversationId)}/documents/${encodeURIComponent(documentId)}/source`;
}

export async function fetchConversationDocumentSource(
  conversationId: string,
  documentId: string,
): Promise<Blob> {
  if (!isAccessTokenValid()) {
    await refreshSession();
  }

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response = await fetch(
    conversationDocumentSourceUrl(conversationId, documentId),
    { credentials: "include", headers },
  );

  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      const retryHeaders: Record<string, string> = {};
      const retryToken = getToken();
      if (retryToken) retryHeaders.Authorization = `Bearer ${retryToken}`;
      response = await fetch(
        conversationDocumentSourceUrl(conversationId, documentId),
        { credentials: "include", headers: retryHeaders },
      );
    }
  }

  if (!response.ok) {
    throw new Error(`document source failed: ${response.status}`);
  }
  return response.blob();
}

export function updateConversationDocument(
  conversationId: string,
  documentId: string,
  input: UpdateConversationDocumentInput,
): Promise<ConversationDocumentDetail> {
  return request<ConversationDocumentDetail>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/documents/${encodeURIComponent(documentId)}`,
    method: "PATCH",
    data: input,
  });
}

export interface StreamConversationAgentOptions {
  signal?: AbortSignal;
  onEvent: (event: AgentRunStreamEvent) => void;
}

export interface StreamEventOptions<T> {
  signal?: AbortSignal;
  onEvent: (event: T) => void;
}

export interface DocumentIngestBatchStartedEvent {
  type: "batch_started";
  total: number;
  max_parallel: number;
}

export interface DocumentIngestFileStartedEvent {
  type: "file_started";
  index: number;
  client_ref: string;
  filename: string;
}

export interface DocumentIngestFileProgressEvent {
  type: "file_progress";
  index: number;
  client_ref: string;
  artifact_id: string;
  status: IngestStatus;
  progress: number;
}

export interface DocumentIngestFileReadyEvent {
  type: "file_ready";
  index: number;
  client_ref: string;
  artifact_id: string;
  progress: number;
  document: ConversationDocumentDetail;
}

export interface DocumentIngestFileFailedEvent {
  type: "file_failed";
  index: number;
  client_ref: string;
  artifact_id?: string | null;
  error: string;
  code?: string | null;
}

export interface DocumentIngestBatchDoneEvent {
  type: "batch_done";
  succeeded: number;
  failed: number;
}

export type DocumentIngestStreamEvent =
  | DocumentIngestBatchStartedEvent
  | DocumentIngestFileStartedEvent
  | DocumentIngestFileProgressEvent
  | DocumentIngestFileReadyEvent
  | DocumentIngestFileFailedEvent
  | DocumentIngestBatchDoneEvent;

async function openEventStream<T>(
  url: string,
  init: { method: "GET" } | { method: "POST"; body: string | FormData },
  { onEvent, signal }: StreamEventOptions<T>,
) {
  if (!isAccessTokenValid()) {
    await refreshSession();
  }

  let response = await sendStreamRequest(url, init, signal);

  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await sendStreamRequest(url, init, signal);
    }
  }

  if (!response.ok || !response.body) {
    let detail = `stream failed: ${response.status}`;
    try {
      const text = await response.text();
      if (text) detail = text;
    } catch {
      // body already consumed or unreadable; keep the status detail
    }
    throw new Error(detail);
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
          onEvent(JSON.parse(data) as T);
        }

        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function sendStreamRequest(
  url: string,
  init: { method: "GET" } | { method: "POST"; body: string | FormData },
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (init.method === "POST" && typeof init.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    return await fetch(url, {
      method: init.method,
      credentials: "include",
      headers,
      body: init.method === "POST" ? init.body : undefined,
      signal,
    });
  } catch (error) {
    throw toApiError(error);
  }
}

export async function streamConversationAgent(
  conversationId: string,
  input: RunConversationAgentInput,
  options: StreamConversationAgentOptions,
): Promise<void> {
  const url = `${API_BASE_URL}${BASE}/${encodeURIComponent(conversationId)}/agents/run/stream`;
  const body = JSON.stringify({
    prompt: input.prompt,
    provider_id: input.provider_id ?? null,
    multimodal_provider_id: input.multimodal_provider_id ?? null,
    document_ids: input.document_ids ?? [],
    thinking: input.thinking ?? null,
    reasoning_effort: input.reasoning_effort ?? null,
  });
  await openEventStream<AgentRunStreamEvent>(
    url,
    { method: "POST", body },
    options,
  );
}

export async function resumeConversationAgent(
  conversationId: string,
  options: StreamConversationAgentOptions,
): Promise<void> {
  const url = `${API_BASE_URL}${BASE}/${encodeURIComponent(conversationId)}/agents/run/stream`;
  await openEventStream<AgentRunStreamEvent>(url, { method: "GET" }, options);
}

/** @deprecated Upload via `streamKnowledgeIngest` from knowledge-server instead. */
export async function streamConversationDocumentIngest(
  conversationId: string,
  files: Array<{ clientRef: string; file: File }>,
  options: StreamEventOptions<DocumentIngestStreamEvent>,
): Promise<void> {
  const form = new FormData();
  const clientRefs: string[] = [];
  for (const item of files) {
    form.append("files", item.file);
    clientRefs.push(item.clientRef);
  }
  form.append("client_refs", JSON.stringify(clientRefs));
  const url = `${API_BASE_URL}${BASE}/${encodeURIComponent(conversationId)}/documents/ingest/stream`;
  await openEventStream<DocumentIngestStreamEvent>(
    url,
    { method: "POST", body: form },
    options,
  );
}
