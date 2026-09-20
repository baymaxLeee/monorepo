import { authFetch, conversationAgentStreamUrl } from "@repo/api";
import { DefaultChatTransport, type UIMessage } from "ai";
export function createConversationTransport<MESSAGE extends UIMessage>(
  conversationId: string,
  options: { fetch?: typeof fetch } = {},
) {
  return new DefaultChatTransport<MESSAGE>({
    api: conversationAgentStreamUrl(conversationId),
    credentials: "include",
    fetch: options.fetch ?? authFetch,
    prepareSendMessagesRequest: ({ messages, id, body }) => ({ body: { ...body, id, message: messages.at(-1) } }),
    prepareReconnectToStreamRequest: ({ api, credentials, headers }) => ({ api, credentials, headers }),
  });
}
