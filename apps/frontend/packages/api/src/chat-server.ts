import { API_BASE_URL, request, toApiError } from "./http";
import { getToken } from "./storage";

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
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface CreateConversationInput {
  title?: string;
}

export interface UpdateConversationInput {
  title?: string;
}

export interface SendMessageInput {
  content: string;
  /** Enable chain-of-thought reasoning (e.g. DeepSeek V4 `thinking: enabled`). */
  thinking?: boolean | null;
  /** Reasoning compute budget for thinking-enabled models. */
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
    data: { title: input.title ?? "新对话" },
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

export interface StreamMessageOptions {
  signal?: AbortSignal;
  onChunk: (chunk: string) => void;
}

/**
 * Stream the assistant reply for a `(conversationId, userContent)` pair.
 *
 * SSE is intentionally narrow here — frames are `data: <json-encoded-string>`
 * separated by blank lines, terminated by `data: [DONE]`. `axios` does not
 * surface a streaming response in browsers, so this is the one place in the
 * frontend where we have to use `fetch` directly. The wrapper keeps that
 * detail out of every MFE; consumers only see `onChunk`.
 */
export async function streamChatMessage(
  conversationId: string,
  payload: SendMessageInput,
  { onChunk, signal }: StreamMessageOptions,
): Promise<void> {
  const url = `${API_BASE_URL}${BASE}/${encodeURIComponent(conversationId)}/messages`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    throw toApiError(error);
  }

  if (!response.ok || !response.body) {
    let detail = `chat stream failed: ${response.status}`;
    try {
      const body = await response.text();
      if (body) detail = body;
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
          if (data === "[DONE]") {
            return;
          }
          try {
            const decoded = JSON.parse(data) as string;
            onChunk(decoded);
          } catch {
            onChunk(data);
          }
        }

        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
