import { authFetch, conversationAgentStreamUrl } from "@repo/api";
import { randomId } from "@repo/shared";
import { DefaultChatTransport, type UIMessage } from "ai";
export function createConversationTransport<MESSAGE extends UIMessage>(
  conversationId: string,
  options: { fetch?: typeof fetch; getExpectedRevision?: () => number | undefined } = {},
) {
  let pending: { body: Record<string, unknown>; messages: MESSAGE[] } | null = null;
  let retry = false;
  const transport = new DefaultChatTransport<MESSAGE>({
    api: conversationAgentStreamUrl(conversationId),
    credentials: "include",
    fetch: options.fetch ?? authFetch,
    prepareSendMessagesRequest: ({ messages, id, body, trigger, messageId }) => {
      if (retry && pending) {
        retry = false;
        return { body: pending.body };
      }
      const targetedMessage =
        trigger === "submit-message" && messageId ? messages.find((message) => message.id === messageId) : undefined;
      const requestId = typeof body?.request_id === "string" ? body.request_id : randomId().replaceAll("-", "");
      const message = targetedMessage ?? messages.at(-1);
      const requestBody = {
        ...body,
        id,
        trigger,
        messageId,
        expected_revision: body?.expected_revision ?? options.getExpectedRevision?.(),
        request_id: requestId,
        message,
      };
      pending = structuredClone({ body: requestBody, messages });
      return { body: requestBody };
    },
    prepareReconnectToStreamRequest: ({ api, credentials, headers }) => ({ api, credentials, headers }),
  });
  return Object.assign(transport, {
    getPendingRequest: () => pending,
    prepareRetry: () => {
      retry = true;
    },
    clearPendingRequest: () => {
      pending = null;
      retry = false;
    },
  });
}
