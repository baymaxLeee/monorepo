import { API_BASE_URL } from "./http";

/** AI SDK UIMessage stream endpoint; the caller owns the fetch/SSE lifecycle. */
export function conversationAgentStreamUrl(conversationId: string): string {
  return `${API_BASE_URL}/api/chat-server/conversations/${encodeURIComponent(conversationId)}/stream`;
}
