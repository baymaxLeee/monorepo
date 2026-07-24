import {
  type ConversationContextResponse,
  getChatService,
  type MemoryCandidate,
  type UpdateMemoryCandidate,
  type UserMemory,
  type VideoProduction,
  type VideoProductionDecision,
  type VideoProductionDetail,
} from "../generated/chat-server/index";
import { authFetch } from "./auth-fetch";
import { API_BASE_URL, type ApiRequestConfig, request } from "./http";

export type {
  ConversationContextCategory,
  ConversationContextResponse,
  ConversationContextView,
  MemoryCandidate,
  MemoryCategory,
  UserMemory,
  VideoProduction,
  VideoProductionDecision,
  VideoProductionDetail,
  VideoProductionShotReviewsItem,
  VideoShot,
  VideoShotPlan,
  VideoTake,
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
  org_id: string;
  title: string;
  model: string;
  provider_id: string;
  active_plan_path: string | null;
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
  latest_run_id: string | null;
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
  index_status?: IndexStatus;
  index_error?: string | null;
  created_at: string;
  updated_at: string;
}

export type IngestStatus =
  | "pending"
  | "queued"
  | "storing"
  // Bytes stored + referenceable; the MarkItDown/vision convert then runs in the
  // background (received -> converting -> ready) so upload does not block on it.
  | "received"
  | "converting"
  | "ready"
  | "failed";

export type IndexStatus =
  | "pending"
  | "indexing"
  | "indexed"
  | "skipped"
  | "failed";

export interface ConversationDocumentDetail extends ConversationDocument {
  content_md: string;
}

export interface ConversationFileDetail {
  path: string;
  title: string;
  filename: string;
  mime_type: string;
  size: number | null;
  sha256: string;
  writable: boolean;
  derived: boolean;
  content: string;
}

export interface UpdateConversationDocumentInput {
  title?: string;
  content_md?: string;
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

export function fetchConversationContext(
  id: string,
  options?: Pick<ApiRequestConfig, "signal" | "skipErrorNotify">,
): Promise<ConversationContextResponse> {
  return request<ConversationContextResponse>({
    url: `${BASE}/${encodeURIComponent(id)}/context`,
    method: "GET",
    ...options,
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

export function fetchConversationFile(
  conversationId: string,
  path: string,
): Promise<ConversationFileDetail> {
  const params = new URLSearchParams({ path });
  return request<ConversationFileDetail>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/files/detail?${params.toString()}`,
    method: "GET",
  });
}

export function conversationFileSourceUrl(
  conversationId: string,
  path: string,
): string {
  const params = new URLSearchParams({ path });
  return `${API_BASE_URL}${BASE}/${encodeURIComponent(conversationId)}/files/source?${params.toString()}`;
}

export async function fetchConversationFileSource(
  conversationId: string,
  path: string,
): Promise<Blob> {
  const response = await authFetch(
    conversationFileSourceUrl(conversationId, path),
  );
  if (!response.ok) throw new Error(`file source failed: ${response.status}`);
  return response.blob();
}

export function conversationDocumentSourceUrl(
  conversationId: string,
  documentId: string,
  options?: { maxDim?: number },
): string {
  const path = `${API_BASE_URL}${BASE}/${encodeURIComponent(conversationId)}/documents/${encodeURIComponent(documentId)}/source`;
  if (!options?.maxDim) return path;
  const params = new URLSearchParams({ max_dim: String(options.maxDim) });
  return `${path}?${params.toString()}`;
}

export async function fetchConversationDocumentSource(
  conversationId: string,
  documentId: string,
  options?: { maxDim?: number },
): Promise<Blob> {
  const response = await authFetch(
    conversationDocumentSourceUrl(conversationId, documentId, options),
  );
  if (!response.ok) {
    throw new Error(`document source failed: ${response.status}`);
  }
  return response.blob();
}

export function fetchVideoProduction(
  conversationId: string,
  productionId: string,
): Promise<VideoProductionDetail> {
  return request<VideoProductionDetail>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/video-productions/${encodeURIComponent(productionId)}`,
    method: "GET",
  });
}

export function decideVideoProduction(
  conversationId: string,
  productionId: string,
  decision: VideoProductionDecision,
): Promise<VideoProduction> {
  return request<VideoProduction>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/video-productions/${encodeURIComponent(productionId)}/decisions`,
    method: "POST",
    data: decision,
  });
}

export async function fetchVideoProductionPreview(
  conversationId: string,
  productionId: string,
): Promise<Blob> {
  const response = await authFetch(
    `${API_BASE_URL}${BASE}/${encodeURIComponent(conversationId)}/video-productions/${encodeURIComponent(productionId)}/preview`,
  );
  if (!response.ok) throw new Error(`video preview failed: ${response.status}`);
  return response.blob();
}

export async function fetchVideoTakePreview(
  conversationId: string,
  productionId: string,
  shotId: string,
  takeId: string,
): Promise<Blob> {
  const response = await authFetch(
    `${API_BASE_URL}${BASE}/${encodeURIComponent(conversationId)}/video-productions/${encodeURIComponent(productionId)}/shots/${encodeURIComponent(shotId)}/takes/${encodeURIComponent(takeId)}/preview`,
  );
  if (!response.ok)
    throw new Error(`video take preview failed: ${response.status}`);
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

export interface AgentTraceStep {
  id: string;
  stepIndex: number;
  kind: string;
  status: "running" | "completed" | "failed";
  summary: string | null;
  createdAt: string;
  finishedAt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  contextSnapshot: ConversationContextSnapshot | null;
}

export type ContextCategoryId =
  | "system"
  | "tools"
  | "rules"
  | "skills"
  | "mcp"
  | "memory"
  | "conversation";

export interface ConversationContextSnapshot {
  version: 1;
  usedTokens: number;
  inputTokens: number;
  retainedOutputTokens: number;
  breakdownEstimated: true;
  categories: Array<{ id: ContextCategoryId; tokens: number }>;
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
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  contextWindow: number | null;
  steps: AgentTraceStep[];
  toolCalls: AgentTraceToolCall[];
}

export async function fetchConversationAgentTrace(
  conversationId: string,
  runId: string,
  options?: Pick<ApiRequestConfig, "signal" | "skipErrorNotify">,
): Promise<AgentRunTrace> {
  return request<AgentRunTrace>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/agents/runs/${encodeURIComponent(runId)}/trace`,
    method: "GET",
    ...options,
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
