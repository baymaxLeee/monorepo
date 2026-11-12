import type { UIMessage } from "ai";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@repo/api", () => ({
  authFetch: vi.fn(),
  conversationAgentStreamUrl: (id: string) => `/api/chat-server/conversations/${id}/agent`,
}));

import { createConversationTransport } from "./transport";

afterEach(() => vi.unstubAllGlobals());

function emptySseResponse() {
  return new Response("data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
}

test("the official transport request preserves operation identity and concurrency controls", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => emptySseResponse());
  const transport = createConversationTransport<UIMessage>("conversation", { fetch });
  const messages: UIMessage[] = [
    { id: "user", role: "user", parts: [{ type: "text", text: "question" }] },
    {
      id: "assistant-target",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "browser_tool",
          toolCallId: "call",
          state: "output-available",
          input: { query: "one" },
          output: { ok: true },
        },
      ],
    },
    { id: "newer-local", role: "user", parts: [{ type: "text", text: "do not submit me" }] },
  ];

  await transport.sendMessages({
    trigger: "submit-message",
    chatId: "conversation",
    messageId: "assistant-target",
    messages,
    abortSignal: undefined,
    body: {
      agent_id: "agent",
      mode: "normal",
      expected_revision: 7,
      request_id: "logical-request",
    },
  });

  const [, init] = fetch.mock.calls[0]!;
  expect(JSON.parse(String(init?.body))).toEqual({
    agent_id: "agent",
    mode: "normal",
    expected_revision: 7,
    request_id: "logical-request",
    id: "conversation",
    trigger: "submit-message",
    messageId: "assistant-target",
    message: messages[1],
  });
  expect(init?.credentials).toBe("include");
  expect(transport.resumeStreamIsReplay).toBe(true);
});

test("regeneration retains its target even though the SDK sends only the parent history", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => emptySseResponse());
  const transport = createConversationTransport<UIMessage>("conversation", { fetch });
  const messages: UIMessage[] = [{ id: "user", role: "user", parts: [{ type: "text", text: "question" }] }];

  await transport.sendMessages({
    trigger: "regenerate-message",
    chatId: "conversation",
    messageId: "old-assistant",
    messages,
    abortSignal: undefined,
    body: { expected_revision: 4, request_id: "regenerate-request" },
  });

  const [, init] = fetch.mock.calls[0]!;
  expect(JSON.parse(String(init?.body))).toMatchObject({
    trigger: "regenerate-message",
    messageId: "old-assistant",
    message: messages[0],
  });
});

test("an explicit retry preserves the entire original operation and request id", async () => {
  // Public HTTP origins expose getRandomValues, but not randomUUID.
  vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => emptySseResponse());
  let revision = 7;
  const transport = createConversationTransport<UIMessage>("conversation", {
    fetch,
    getExpectedRevision: () => revision,
  });
  const original = {
    trigger: "regenerate-message" as const,
    chatId: "conversation",
    messageId: "target",
    messages: [{ id: "user", role: "user" as const, parts: [{ type: "text" as const, text: "question" }] }],
    abortSignal: undefined,
    body: { mode: "plan" },
  };
  await transport.sendMessages(original);
  const first = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
  expect(first.request_id).toMatch(/^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
  revision = 9;
  transport.prepareRetry();
  await transport.sendMessages({
    ...original,
    trigger: "submit-message",
    messageId: "new-local",
    messages: [],
    body: { mode: "normal" },
  });
  expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toEqual(first);
  transport.clearPendingRequest();
  await transport.sendMessages(original);
  const next = JSON.parse(String(fetch.mock.calls[2]![1]?.body));
  expect(next.request_id).not.toBe(first.request_id);
  expect(next.expected_revision).toBe(9);
});

test("SDK edit keeps the new message id aligned between the local snapshot and wire", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => emptySseResponse());
  const transport = createConversationTransport<UIMessage>("conversation", { fetch });
  const edited: UIMessage = { id: "new-user", role: "user", parts: [{ type: "text", text: "edited" }] };
  await transport.sendMessages({
    trigger: "submit-message",
    chatId: "conversation",
    messageId: "old-user",
    messages: [edited],
    abortSignal: undefined,
  });
  expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ messageId: "old-user", message: edited });
});

test("the official transport rejects structurally invalid UIMessage chunks", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response('data: {"type":"not-a-ui-message-chunk"}\n\ndata: [DONE]\n\n', {
        headers: { "content-type": "text/event-stream" },
      }),
  );
  const transport = createConversationTransport<UIMessage>("conversation", { fetch });
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: "conversation",
    messageId: "user",
    messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "question" }] }],
    abortSignal: undefined,
  });
  await expect(async () => {
    for await (const _chunk of stream) {
      // Parsing itself is the assertion: invalid chunks must fail before reaching Chat.
    }
  }).rejects.toThrow();
});
