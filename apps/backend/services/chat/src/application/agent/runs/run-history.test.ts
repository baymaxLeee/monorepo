import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "../../conversations.js";
import { persistedMessagesToModelUiMessages, removeStoredResponseReferences } from "./run.js";

function message(id: string, role: Message["role"], status: Message["status"]): Message {
  return {
    id,
    conversation_id: "conversation",
    role,
    status,
    content: { version: 2, parts: [{ type: "text", text: id }] },
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

test("full history replay removes stored response item references", () => {
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
      ],
    },
  ]);
  assert.deepEqual(projected?.parts, [{ type: "text", text: "done" }]);
});
