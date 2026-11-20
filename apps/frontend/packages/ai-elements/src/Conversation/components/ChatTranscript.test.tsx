import { Conversation, ConversationContent } from "@repo/ai-elements";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import type { ChatUIMessage } from "../lib/chat-message";
import { ChatTranscript } from "./ChatTranscript";

test("an empty streaming assistant uses one stable message row for its pending state", () => {
  const messages: ChatUIMessage[] = [
    {
      id: "assistant",
      role: "assistant",
      parts: [{ type: "text", text: "", state: "streaming" }],
    },
  ];
  const view = render(
    <Conversation>
      <ConversationContent>
        <ChatTranscript
          conversationId="conversation"
          messages={messages}
          status="streaming"
          loading={false}
          branches={[]}
        />
      </ConversationContent>
    </Conversation>,
  );

  expect(screen.getByRole("status").textContent).toContain("正在思考");
  expect(view.container.querySelectorAll('[data-slot="message-scroller-item"]')).toHaveLength(1);
  expect(view.container.querySelector('[data-message-id="assistant"]')?.contains(screen.getByRole("status"))).toBe(
    true,
  );
});

test("submission keeps the same pending indicator until assistant content arrives", () => {
  const user: ChatUIMessage = { id: "user", role: "user", parts: [{ type: "text", text: "hello" }] };
  const assistant: ChatUIMessage = {
    id: "answer",
    role: "assistant",
    parts: [{ type: "reasoning", text: "", state: "streaming" }],
  };
  function transcript(messages: ChatUIMessage[], status: "submitted" | "streaming") {
    return (
      <Conversation>
        <ConversationContent>
          <ChatTranscript conversationId="chat" loading={false} branches={[]} messages={messages} status={status} />
        </ConversationContent>
      </Conversation>
    );
  }
  const view = render(transcript([user], "submitted"));
  const pending = screen.getByRole("status");
  const replyRow = pending.closest('[data-slot="message-scroller-item"]');
  view.rerender(transcript([user, assistant], "streaming"));
  expect(screen.getByRole("status")).toBe(pending);
  expect(screen.queryByText("思考中…")).toBeNull();
  view.rerender(
    transcript(
      [user, { ...assistant, parts: [{ type: "text", text: "first delta", state: "streaming" }] }],
      "streaming",
    ),
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(replyRow?.contains(screen.getByText("first delta"))).toBe(true);
});
