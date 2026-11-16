import type { ModelMessage } from "ai";

/**
 * A stored Responses function call already belongs to `previousResponseId`.
 * When a client-executed tool (for example ask_user) resumes in a new run,
 * only its tool result is new input. Re-sending the assistant tool call can
 * make compatible Responses providers discard the request input entirely.
 */
export function newMessagesForStoredResponse(messages: ModelMessage[]): ModelMessage[] {
  const toolResults = messages.filter((message) => message.role === "tool");
  return toolResults.length > 0 ? toolResults : messages;
}
