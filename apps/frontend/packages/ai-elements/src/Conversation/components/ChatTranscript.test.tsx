import { Conversation, ConversationContent } from "@repo/ai-elements";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import type { ChatUIMessage } from "../lib/chat-message";
import { ChatTranscript } from "./ChatTranscript";

test("plan snapshots stay out of the transcript while plan failures remain visible", async () => {
  const todo = {
    type: "tool-update_plan",
    toolCallId: "first",
    toolMetadata: { agent: { uiKind: "todo-list" } },
    state: "output-available",
    input: {},
    output: { ok: true, status: "completed", data: { plan: [{ step: "核对需求", status: "pending" }] } },
  } as const;
  const first: ChatUIMessage = {
    id: "first-reply",
    role: "assistant",
    parts: [todo, { type: "text", text: "需求已记录" }],
  };
  const next = {
    type: "dynamic-tool",
    toolName: "update_plan",
    toolCallId: "second",
    toolMetadata: todo.toolMetadata,
    state: "input-streaming",
  } as const;
  function transcript(messages: ChatUIMessage[], status: "streaming" | "ready") {
    return (
      <Conversation>
        <ConversationContent>
          <ChatTranscript conversationId="chat" loading={false} branches={[]} messages={messages} status={status} />
        </ConversationContent>
      </Conversation>
    );
  }
  const view = render(transcript([first], "streaming"));
  expect(await screen.findByText("需求已记录")).toBeTruthy();
  expect(screen.queryByText("核对需求")).toBeNull();
  expect(screen.queryByRole("button", { name: /update_plan/ })).toBeNull();
  const failed: ChatUIMessage = {
    ...first,
    parts: [...first.parts, { ...next, state: "output-error", input: {}, errorText: "更新清单失败" }],
  };
  view.rerender(transcript([failed], "ready"));
  const failedTool = await screen.findByRole("button", { name: /update_plan/ });
  expect(failedTool.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("更新清单失败")).toBeNull();
  fireEvent.click(failedTool);
  expect(screen.getByText("更新清单失败")).toBeTruthy();
});

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

test("an active host run keeps the pending row visible while the transport is ready", () => {
  const user: ChatUIMessage = { id: "user", role: "user", parts: [{ type: "text", text: "hello" }] };
  render(
    <Conversation>
      <ConversationContent>
        <ChatTranscript
          conversationId="conversation"
          messages={[user]}
          status="ready"
          runActive
          loading={false}
          branches={[]}
        />
      </ConversationContent>
    </Conversation>,
  );

  expect(screen.getByRole("status").textContent).toContain("正在思考");
});

test("an approval remains open while the transport is ready", async () => {
  const assistant: ChatUIMessage = {
    id: "assistant",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "write_file",
        toolCallId: "approval",
        state: "approval-requested",
        input: { path: "report.md" },
        approval: { id: "approval" },
      },
    ],
  };
  render(
    <Conversation>
      <ConversationContent>
        <ChatTranscript
          conversationId="conversation"
          messages={[assistant]}
          status="ready"
          loading={false}
          branches={[]}
          onToolApproval={() => {}}
        />
      </ConversationContent>
    </Conversation>,
  );

  expect((await screen.findByRole("button", { name: /write_file.*等待授权/ })).getAttribute("aria-expanded")).toBe(
    "true",
  );
  expect(screen.getByRole("button", { name: "允许" })).toBeTruthy();
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
