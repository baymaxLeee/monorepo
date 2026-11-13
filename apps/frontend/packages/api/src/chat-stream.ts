import { API_BASE_URL } from "./http";

/** AI SDK UIMessage stream endpoint; the caller owns the fetch/SSE lifecycle. */
export function conversationAgentStreamUrl(conversationId: string): string {
  return `${API_BASE_URL}/api/chat-server/conversations/${encodeURIComponent(conversationId)}/agents/run/stream`;
}

/** Browser-renderable redirect endpoint for a conversation document. */
export function conversationDocumentContentUrl(conversationId: string, documentId: string): string {
  return `${API_BASE_URL}/api/chat-server/conversations/${encodeURIComponent(conversationId)}/documents/${encodeURIComponent(documentId)}/content`;
}
