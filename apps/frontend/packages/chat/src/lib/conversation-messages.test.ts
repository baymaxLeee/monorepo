import type { Message } from "@repo/api";
import { expect, test } from "vitest";

import type { ChatUIMessage } from "./chat-message";
import { hasCompletedClientTool, hasPendingClientTool, validateConversationMessages } from "./conversation-messages";

test("hydration accepts empty history and native user messages without metadata", async () => {
  expect(await validateConversationMessages([])).toEqual([]);
  const stored = { id: "user", role: "user", content: { parts: [{ type: "text", text: "hello" }] } } as Message;
  expect(await validateConversationMessages([stored])).toMatchObject([
    { id: "user", role: "user", parts: stored.content.parts },
  ]);
});

test("hydration rejects malformed native parts and unregistered business data", async () => {
  for (const part of [
    { type: "text", text: 42 },
    { type: "data-unknown", data: {} },
  ]) {
    const stored = { id: "user", role: "user", content: { parts: [part] } } as Message;
    await expect(validateConversationMessages([stored])).rejects.toThrow();
  }
});

test("dynamic client tools participate in continuation while preliminary and provider results do not", () => {
  const part = {
    type: "dynamic-tool" as const,
    toolName: "ask_user",
    toolCallId: "call",
    state: "input-available" as const,
    input: {},
    toolMetadata: { agent: { execution: "client" } },
  };
  const message = (value: ChatUIMessage["parts"][number]): ChatUIMessage[] => [
    { id: "assistant", role: "assistant", parts: [value] },
  ];
  expect(hasPendingClientTool(message(part))).toBe(true);
  expect(hasPendingClientTool(message({ ...part, providerExecuted: true }))).toBe(false);
  expect(hasCompletedClientTool(message({ ...part, state: "output-available", output: {}, preliminary: true }))).toBe(
    false,
  );
  expect(hasCompletedClientTool(message({ ...part, state: "output-available", output: {} }))).toBe(true);
  expect(hasCompletedClientTool(message({ ...part, state: "output-error", errorText: "failed" }))).toBe(true);
});
