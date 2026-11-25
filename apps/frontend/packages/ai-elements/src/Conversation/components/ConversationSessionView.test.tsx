import { type Chat } from "@ai-sdk/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { expect, test, vi } from "vitest";

import type { ChatUIMessage } from "../lib/chat-message";

vi.mock("./ChatStream", () => ({
  ChatStream: () => {
    const [delta, setDelta] = useState(0);
    return (
      <button type="button" onClick={() => setDelta((current) => current + 1)}>
        流式正文 {delta}
      </button>
    );
  },
}));

import { ConversationSessionView } from "./ConversationSessionView";

test("pending inputs live outside the streaming transcript measurement boundary", () => {
  render(
    <ConversationSessionView
      title="会话"
      chat={{} as Chat<ChatUIMessage>}
      conversationId="conversation"
      loading={false}
      branches={[]}
      pendingInputs={[{ id: "pending", text: "继续梳理", mode: "follow-up", state: "accepted" }]}
      scrollRef={createRef()}
      onStatusChange={vi.fn()}
      composer={() => <div>输入区</div>}
    />,
  );

  const pending = screen.getByLabelText("待发送消息");
  expect(pending.closest('[data-slot="message-scroller-content"]')).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "流式正文 0" }));

  expect(screen.getByLabelText("待发送消息")).toBe(pending);
  expect(screen.getByRole("button", { name: "流式正文 1" })).toBeTruthy();
});
