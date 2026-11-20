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
