import {
  getChatService,
  type MemoryCandidate,
  type UpdateMemoryCandidate,
  type UserMemory,
} from "../generated/chat-server/index";
import { authFetch } from "./auth-fetch";
import { API_BASE_URL, request } from "./http";

export type {
  MemoryCandidate,
  MemoryCategory,
  UserMemory,
} from "../generated/chat-server/index";

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "ok" | "streaming" | "failed";
export type ReasoningEffort = "low" | "medium" | "high";

/**
 * Persisted message content mirrors the backend shape: serialized UIMessage
 * parts stored as structured JSON (matching the AI SDK persistence shape),
 * wrapped in a `version` envelope for forward-compatible part migrations.
 */
export interface PersistedMessageContent {
  version: number;
  parts: unknown[];
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: PersistedMessageContent;
  status: MessageStatus;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  model: string;
  provider_id: string;
  active_plan_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
  documents: ConversationDocument[];
  /**
   * Best-effort id of a currently-resumable agent run, or null when nothing is
   * live. Lets the client skip the reconnect probe on load; the reconnect
   * endpoint stays authoritative.
   */
  active_run_id: string | null;
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

export interface StreamEventOptions<T> {
  signal?: AbortSignal;
  onEvent: (event: T) => void;
}

const BASE = "/api/chat-server/conversations";

export function conversationAgentStreamUrl(conversationId: string): string {
  return `${API_BASE_URL}${BASE}/${encodeURIComponent(conversationId)}/agents/run/stream`;
}

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
  const response = await authFetch(
    conversationDocumentSourceUrl(conversationId, documentId),
  );
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

export interface AgentTraceStep {
  id: string;
  stepIndex: number;
  kind: string;
  status: "running" | "completed" | "failed";
  summary: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AgentTraceToolCall {
  id: string;
  stepIndex: number | null;
  toolName: string;
  status: "running" | "completed" | "failed";
  durationMs: number | null;
  error: string | null;
}

export interface AgentRunTrace {
  runId: string;
  status:
    | "running"
    | "awaiting_approval"
    | "completed"
    | "failed"
    | "cancelled";
  model: string;
  totalTokens: number | null;
  steps: AgentTraceStep[];
  toolCalls: AgentTraceToolCall[];
}

export async function fetchConversationAgentTrace(
  conversationId: string,
  runId: string,
): Promise<AgentRunTrace> {
  return request<AgentRunTrace>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/agents/runs/${encodeURIComponent(runId)}/trace`,
    method: "GET",
  });
}

export function cancelConversationAgentRun(
  conversationId: string,
  runId: string,
): Promise<{ cancelled: boolean; status?: string }> {
  return request({
    url: `${BASE}/${encodeURIComponent(conversationId)}/agents/runs/${encodeURIComponent(runId)}/cancel`,
    method: "POST",
  });
}

export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Task {
  id: string;
  type: string;
  status: TaskStatus;
  ownerService: string;
  ownerRef: string;
  result: unknown;
  progress: { done: number; total: number } | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export function fetchConversationTask(
  conversationId: string,
  taskId: string,
): Promise<Task> {
  return request({
    url: `${BASE}/${encodeURIComponent(conversationId)}/tasks/${encodeURIComponent(taskId)}`,
    method: "GET",
  });
}

export type UpdateMemoryCandidateInput = UpdateMemoryCandidate;

const memoryClient = getChatService();
const memoryClientOptions = { baseURL: `${API_BASE_URL}/api/chat-server` };

// Memory reads feed the panel's inline error state, so they opt out of the
// interceptor toast; the mutations below keep the default toast.
export function fetchActiveMemories(): Promise<{ memories: UserMemory[] }> {
  return memoryClient.getMemories({
    ...memoryClientOptions,
    skipErrorNotify: true,
  });
}

export function fetchMemoryCandidates(): Promise<{
  candidates: MemoryCandidate[];
}> {
  return memoryClient.getMemoriesCandidates({
    ...memoryClientOptions,
    skipErrorNotify: true,
  });
}

export function approveMemoryCandidate(
  id: string,
): Promise<{ memory: UserMemory }> {
  return memoryClient.postMemoriesCandidatesIdApprove(id, memoryClientOptions);
}

export function rejectMemoryCandidate(
  id: string,
): Promise<{ rejected: boolean }> {
  return memoryClient.postMemoriesCandidatesIdReject(id, memoryClientOptions);
}

export function updateMemoryCandidate(
  id: string,
  input: UpdateMemoryCandidateInput,
): Promise<{ candidate: MemoryCandidate }> {
  return memoryClient.patchMemoriesCandidatesId(id, input, memoryClientOptions);
}

export function deleteMemory(id: string): Promise<{ deleted: boolean }> {
  return memoryClient.deleteMemoriesId(id, memoryClientOptions);
}
