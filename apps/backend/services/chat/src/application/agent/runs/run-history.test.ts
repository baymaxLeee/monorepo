import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "../../conversations.js";
import {
  isStoredResponseLineageCurrent,
  persistedMessagesToModelUiMessages,
  removeStoredResponseReferences,
} from "./run.js";

function message(id: string, role: Message["role"], status: Message["status"]): Message {
  return {
    id,
    conversation_id: "conversation",
    role,
    status,
    content: { version: 2, parts: [{ type: "text", text: id }] },
    parent_message_id: null,
    branch_index: 0,
    created_at: "2026-10-28T00:00:00Z",
  };
}

test("failed assistant output is excluded from subsequent model context", () => {
  const projected = persistedMessagesToModelUiMessages([
    message("first", "user", "ok"),
    message("broken", "assistant", "failed"),
    message("retry", "user", "ok"),
  ]);
  assert.deepEqual(
    projected.map(({ id }) => id),
    ["first", "retry"],
  );
});

test("full history replay removes stored response item references and opaque provider compaction", () => {
  const [projected] = removeStoredResponseReferences([
    {
      id: "assistant",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "done",
          providerMetadata: { openai: { itemId: "msg_previous" } },
        },
        {
          type: "custom",
          kind: "openai.compaction",
          providerMetadata: {
            openai: { type: "compaction", itemId: "cmp_previous", encryptedContent: "opaque" },
          },
        },
      ],
    },
  ]);
  assert.deepEqual(projected?.parts, [{ type: "text", text: "done" }]);
});

test("stored response lineage must be the immediate journal predecessor", () => {
  const messages: Parameters<typeof isStoredResponseLineageCurrent>[0] = [
    { id: "user-a", role: "user", parts: [{ type: "text", text: "a" }] },
    { id: "assistant-a", role: "assistant", parts: [{ type: "text", text: "a" }] },
    { id: "user-b", role: "user", parts: [{ type: "text", text: "b" }] },
    { id: "assistant-b", role: "assistant", parts: [{ type: "text", text: "b" }] },
    { id: "user-c", role: "user", parts: [{ type: "text", text: "c" }] },
  ];

  assert.equal(isStoredResponseLineageCurrent([...messages], "assistant-a"), false);
  assert.equal(isStoredResponseLineageCurrent([...messages], "assistant-b"), true);
  assert.equal(isStoredResponseLineageCurrent(messages.slice(0, -1), "assistant-b"), true);
});
