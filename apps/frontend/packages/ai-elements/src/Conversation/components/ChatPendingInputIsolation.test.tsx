import { type Chat } from "@ai-sdk/react";
import { render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { ChatUIMessage } from "../lib/chat-message";

const sdk = vi.hoisted(() => ({ messages: [] as unknown[], status: "streaming" as const }));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => sdk,
}));

vi.mock("./ChatTranscript", () => ({ ChatTranscript: () => null }));

import { ChatStreamContent } from "./ChatStream";

function messages(text: string, includeSecond = false): ChatUIMessage[] {
  return [
    {
      id: "assistant",
      role: "assistant",
      parts: [
        { type: "steering-message", id: "first", parts: [{ type: "text", text: "earlier supplement" }] },
        ...(includeSecond
          ? [{ type: "steering-message" as const, id: "second", parts: [{ type: "text" as const, text: "next" }] }]
          : []),
        { type: "text", text, state: "streaming" },
      ],
    },
  ];
}

test("text deltas do not publish another pending-input delivery event", async () => {
  const onPendingInputsDelivered = vi.fn();
  const onStatusChange = vi.fn();
  sdk.messages = messages("first");
  const content = (loading: boolean) => (
    <ChatStreamContent
      chat={{} as Chat<ChatUIMessage>}
      conversationId="conversation"
      loading={loading}
      branches={[]}
      onStatusChange={onStatusChange}
      onPendingInputsDelivered={onPendingInputsDelivered}
    />
  );
  const view = render(content(false));
  await waitFor(() => expect(onPendingInputsDelivered).toHaveBeenCalledTimes(1));

  sdk.messages = messages("next delta");
  view.rerender(content(true));

  await waitFor(() => expect(onPendingInputsDelivered).toHaveBeenCalledTimes(1));

  sdk.messages = messages("last delta", true);
  view.rerender(content(false));
  await waitFor(() => expect(onPendingInputsDelivered).toHaveBeenCalledTimes(2));
  expect(onPendingInputsDelivered.mock.calls[1]?.[0]).toEqual(new Set(["first", "second"]));
});
