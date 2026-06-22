import { request } from "./http";

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

export interface ConvertedAttachment {
  filename: string;
  mime_type: string;
  size: number;
  markdown: string;
  markdown_chars: number;
  truncated: boolean;
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
  created_at: string;
  updated_at: string;
}

export interface ConversationDocumentDetail extends ConversationDocument {
  content_md: string;
}

export interface UpdateConversationDocumentInput {
  title?: string;
  content_md?: string;
}

export interface AgentToolCall {
  name: string;
  input: string;
  output_preview: string;
}

export interface AgentRunResult {
  message: string;
  created_documents: ConversationDocument[];
  tool_calls: AgentToolCall[];
}

export interface RunConversationAgentInput {
  prompt: string;
  provider_id?: string | null;
  document_ids?: string[];
  thinking?: boolean | null;
  reasoning_effort?: ReasoningEffort | null;
}

const BASE = "/api/chat-server/conversations";
const ATTACHMENTS_BASE = "/api/chat-server/attachments";

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

export function convertChatAttachment(
  file: File,
): Promise<ConvertedAttachment> {
  const form = new FormData();
  form.append("file", file);
  return request<ConvertedAttachment>({
    url: `${ATTACHMENTS_BASE}/convert`,
    method: "POST",
    data: form,
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

export function runConversationAgent(
  conversationId: string,
  input: RunConversationAgentInput,
): Promise<AgentRunResult> {
  return request<AgentRunResult>({
    url: `${BASE}/${encodeURIComponent(conversationId)}/agents/run`,
    method: "POST",
    data: {
      prompt: input.prompt,
      provider_id: input.provider_id ?? null,
      document_ids: input.document_ids ?? [],
      thinking: input.thinking ?? null,
      reasoning_effort: input.reasoning_effort ?? null,
    },
  });
}
