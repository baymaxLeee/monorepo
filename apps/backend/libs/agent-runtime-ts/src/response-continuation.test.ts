import assert from "node:assert/strict";
import test from "node:test";

import type { ModelMessage } from "ai";

import { newMessagesForStoredResponse } from "./response-continuation.js";

test("sends only a client tool result when continuing a stored response", () => {
  const assistant = {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "call_ask_user",
        toolName: "ask_user",
        input: { questions: [] },
      },
    ],
  } satisfies ModelMessage;
  const result = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_ask_user",
        toolName: "ask_user",
        output: { type: "json", value: { answers: [] } },
      },
    ],
  } satisfies ModelMessage;

  assert.deepEqual(newMessagesForStoredResponse([assistant, result]), [result]);
});

test("keeps a new user message when continuing a stored response", () => {
  const user = { role: "user", content: [{ type: "text", text: "continue" }] } satisfies ModelMessage;

  assert.deepEqual(newMessagesForStoredResponse([user]), [user]);
});
