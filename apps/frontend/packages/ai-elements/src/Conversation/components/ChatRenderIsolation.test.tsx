import { Message, MessageContent } from "@repo/ai-elements";
import type * as AiElements from "@repo/ai-elements";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { ChatUIMessage } from "../lib/chat-message";
import { ChatMessageView, type ChatMessageViewProps } from "./ChatMessageView";

const renders = vi.hoisted(() => ({ sources: vi.fn(), toolPart: vi.fn() }));

vi.mock("@repo/ai-elements", async (original) => {
  const actual = await original<typeof AiElements>();
  return {
    ...actual,
    Sources: (props: AiElements.SourcesProps) => {
      renders.sources();
      return <actual.Sources {...props} />;
    },
  };
});

vi.mock("./ChatToolPart", () => ({
  ChatToolPart: ({ part }: { part: { toolCallId: string } }) => {
    renders.toolPart(part.toolCallId);
    return <div data-testid={`tool-${part.toolCallId}`} />;
  },
}));

const props: Omit<ChatMessageViewProps, "message"> = {
  conversationId: "conversation",
  streaming: true,
  busy: true,
};

test("text deltas do not update an unchanged sibling tool part", async () => {
  const tool = {
    type: "tool-bash",
    toolCallId: "bash",
    state: "output-available",
    input: { cmd: "test" },
    output: { output: "done", exit_code: 0 },
  } as const;
  const message = (text: string): ChatUIMessage => ({
    id: "reply",
    role: "assistant",
    parts: [{ ...tool }, { type: "text", text, state: "streaming" }],
  });

  const view = render(<ChatMessageView {...props} message={message("first")} />);
  await screen.findByTestId("tool-bash");
  renders.toolPart.mockClear();

  for (let index = 0; index < 5; index++) {
    view.rerender(<ChatMessageView {...props} message={message(`delta ${index}`)} />);
  }

  expect(renders.toolPart).not.toHaveBeenCalled();
});

test("text deltas do not update an unchanged source list", async () => {
  const source = {
    type: "source-url",
    sourceId: "docs",
    url: "https://example.com/docs",
    title: "Docs",
  } as const;
  const message = (text: string): ChatUIMessage => ({
    id: "reply",
    role: "assistant",
    parts: [{ ...source }, { type: "text", text, state: "streaming" }],
  });

  const view = render(<ChatMessageView {...props} message={message("first")} />);
  await screen.findByText("使用了 1 个来源");
  renders.sources.mockClear();
  view.rerender(<ChatMessageView {...props} message={message("next")} />);

  expect(renders.sources).not.toHaveBeenCalled();
});

test("assistant content uses the shared message body without an extra layout wrapper", () => {
  const view = render(
    <Message from="assistant">
      <MessageContent>
        <span data-testid="content" />
      </MessageContent>
    </Message>,
  );

  const body = view.container.querySelector('[data-slot="message-content"]');
  expect(body?.firstElementChild).toBe(screen.getByTestId("content"));
});

test("branch controls do not render hidden placeholder trees for every candidate", () => {
  const message: ChatUIMessage = { id: "reply", role: "assistant", parts: [{ type: "text", text: "answer" }] };
  render(
    <ChatMessageView
      {...props}
      message={message}
      streaming={false}
      busy={false}
      branch={{
        parent_message_id: "parent",
        selected_message_id: "reply",
        candidates: [
          { message_id: "reply", leaf_message_id: "reply", role: "assistant", created_at: "2026-01-01" },
          { message_id: "reply-2", leaf_message_id: "reply-2", role: "assistant", created_at: "2026-01-02" },
          { message_id: "reply-3", leaf_message_id: "reply-3", role: "assistant", created_at: "2026-01-03" },
        ],
      }}
      onSelectBranch={vi.fn()}
    />,
  );

  const selector = screen.getByLabelText("消息候选");
  expect(selector.parentElement?.querySelectorAll("span")).toHaveLength(1);
});
