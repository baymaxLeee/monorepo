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
import { API_BASE_URL, type ApiRequestConfig, request } from "./http";
import { fetchStorageBlob } from "./storage-server";

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
  metadata?: Record<string, unknown>;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: PersistedMessageContent;
  status: MessageStatus;
  parent_message_id: string | null;
  branch_index: number;
  created_at: string;
}

export interface MessageBranchCandidate {
  message_id: string;
  leaf_message_id: string;
  role: MessageRole;
  created_at: string;
}

export interface MessageBranchGroup {
  parent_message_id: string | null;
  selected_message_id: string;
  candidates: MessageBranchCandidate[];
}

export interface Conversation {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  model: string;
  provider_id: string;
  active_plan_path: string | null;
  project_id: string | null;
  canvas_id: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  selected_message_id: string | null;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
  branches: MessageBranchGroup[];
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
  editable_source: boolean;
  title: string;
  filename: string;
  mime_type: string;
  source_size: number;
  source_mime_type?: string | null;
  asset_id?: string | null;
  source_revision_id?: string | null;
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

export type IndexStatus = "pending" | "indexing" | "indexed" | "skipped" | "failed";

export interface ConversationDocumentDetail extends ConversationDocument {
  content_md: string;
}

export interface ConversationFileDetail {
  path: string;
  asset_id: string;
  revision_id: string;
  title: string;
  filename: string;
  mime_type: string;
  size: number | null;
  sha256: string;
  writable: boolean;
  derived: boolean;
  content: string | null;
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

export function fetchConversation(id: string, options?: ApiRequestConfig): Promise<ConversationDetail> {
  return request<ConversationDetail>({
    url: `${BASE}/${encodeURIComponent(id)}`,
    method: "GET",
    ...options,
  });
}

export function selectConversationHistory(
  id: string,
  input: { leaf_message_id: string; expected_revision: number },
): Promise<ConversationDetail> {
  return request<ConversationDetail>({
    url: `${BASE}/${encodeURIComponent(id)}/history/select`,
    method: "POST",
    data: input,
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

export function createConversation(input: CreateConversationInput = {}): Promise<Conversation> {
  return request<Conversation>({
    url: BASE,
    method: "POST",
    data: {
      title: input.title ?? "新对话",
      ...(input.provider_id ? { provider_id: input.provider_id } : {}),
    },
  });
}

export function forkConversation(id: string, messageId: string, options?: Pick<ApiRequestConfig, "skipErrorNotify">) {
  return getChatService().forkConversation(
    id,
    { message_id: messageId },
    { baseURL: `${API_BASE_URL}/api/chat-server`, ...options },
  );
}

export function updateConversation(id: string, input: UpdateConversationInput): Promise<Conversation> {
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

export function uploadConversationDocument(conversationId: string, file: File): Promise<ConversationDocumentDetail> {
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
  options?: { includeContent?: boolean; signal?: AbortSignal },
): Promise<ConversationDocumentDetail> {
  return request<ConversationDocumentDetail>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/documents/${encodeURIComponent(documentId)}`,
    method: "GET",
    params: { include_content: options?.includeContent },
    signal: options?.signal,
  });
}

export function fetchConversationFile(
  conversationId: string,
  path: string,
  options?: { includeContent?: boolean; signal?: AbortSignal },
): Promise<ConversationFileDetail> {
  const params = new URLSearchParams({ path });
  return request<ConversationFileDetail>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/files/detail?${params.toString()}`,
    method: "GET",
    params: { include_content: options?.includeContent },
    signal: options?.signal,
  });
}

export async function fetchConversationDocumentSource(
  conversationId: string,
  documentId: string,
  options?: { maxDim?: number },
): Promise<Blob> {
  const doc = await fetchConversationDocument(conversationId, documentId, { includeContent: false });
  if (!doc.asset_id || !doc.source_revision_id) throw new Error("document has no Storage revision");
  return fetchStorageBlob(
    {
      assetId: doc.asset_id,
      revisionId: doc.source_revision_id,
      owner: { kind: "conversation-document", conversationId, documentId },
    },
    options?.maxDim,
  );
}

export function fetchVideoProduction(conversationId: string, productionId: string): Promise<VideoProductionDetail> {
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

export async function fetchVideoProductionPreview(conversationId: string, productionId: string): Promise<Blob> {
  const capability = await request<{ url: string; expires_at: string }>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/video-productions/${encodeURIComponent(productionId)}/preview-url`,
    method: "GET",
  });
  const response = await fetch(new URL(capability.url, API_BASE_URL || window.location.origin), {
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    throw new Error(`video preview failed: ${response.status}`);
  }
  return response.blob();
}

export async function fetchVideoTakePreview(
  conversationId: string,
  productionId: string,
  shotId: string,
  takeId: string,
): Promise<Blob> {
  const capability = await request<{ url: string; expires_at: string }>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/video-productions/${encodeURIComponent(productionId)}/shots/${encodeURIComponent(shotId)}/takes/${encodeURIComponent(takeId)}/preview-url`,
    method: "GET",
  });
  const response = await fetch(new URL(capability.url, API_BASE_URL || window.location.origin), {
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    throw new Error(`video take preview failed: ${response.status}`);
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

export type ContextCategoryId = "system" | "tools" | "rules" | "skills" | "mcp" | "memory" | "conversation";

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
  status: "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
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
  options?: ApiRequestConfig,
): Promise<{ cancelled: boolean; status?: string }> {
  return request({
    url: `${BASE}/${encodeURIComponent(conversationId)}/agents/runs/${encodeURIComponent(runId)}/cancel`,
    method: "POST",
    ...options,
  });
}

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

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

export function approveMemoryCandidate(id: string): Promise<{ memory: UserMemory }> {
  return memoryClient.postMemoriesCandidatesIdApprove(id, memoryClientOptions);
}

export function rejectMemoryCandidate(id: string): Promise<{ rejected: boolean }> {
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

export function conversationDocumentContentUrl(conversationId: string, documentId: string): string {
  return `${API_BASE_URL}${BASE}/${encodeURIComponent(conversationId)}/documents/${encodeURIComponent(documentId)}/content?document_id=${encodeURIComponent(documentId)}`;
}

export function fetchConversationSourceDelivery(conversationId: string, sourceId: string): Promise<{ url: string }> {
  return request({
    url: `${BASE}/${encodeURIComponent(conversationId)}/sources/${encodeURIComponent(sourceId)}/delivery`,
    method: "POST",
    skipErrorNotify: true,
  });
}
