import { Chat } from "@ai-sdk/react";
import type { ChatTransport, UIMessageChunk } from "ai";
import { expect, test, vi } from "vitest";

import type { ChatUIMessage } from "./chat-message";
import { PageToolSession, type ClientToolExecutor } from "./page-tools";

const call: UIMessageChunk = {
  type: "tool-input-available",
  toolCallId: "call",
  toolName: "act",
  input: { steps: [] },
  toolMetadata: { agent: { execution: "client", uiKind: "agent-ui" } },
};
function renderer(execute: ClientToolExecutor) {
  const page = new PageToolSession(execute);
  const stream = async () =>
    new ReadableStream<UIMessageChunk>({
      start(controller) {
        const chunks: UIMessageChunk[] = [{ type: "start", messageId: "assistant" }, call, call, { type: "finish" }];
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  const base: ChatTransport<ChatUIMessage> = { sendMessages: stream, reconnectToStream: stream };
  const settle = vi.fn();
  const chat = new Chat<ChatUIMessage>({
    transport: page.transport(base),
    onToolCall: ({ toolCall }) => {
      void page.respond(toolCall, settle);
    },
  });
  return { chat, page, settle };
}

test("only the originating page executes a live call, even with duplicate chunks and a second renderer", async () => {
  const execute = vi.fn(async () => "done");
  const owner = renderer(execute);
  const observer = renderer(execute);
  await Promise.all([owner.chat.sendMessage({ text: "change it" }), observer.chat.resumeStream()]);
  expect(execute).toHaveBeenCalledOnce();
  expect(owner.settle).toHaveBeenCalledOnce();
  expect(observer.settle).not.toHaveBeenCalled();
  expect(observer.chat.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ toolCallId: "call" }));
});

test("a stopped page drops a late result", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const execute = vi.fn<ClientToolExecutor>(() => pending);
  const owner = renderer(execute);
  await owner.chat.sendMessage({ text: "change it" });
  owner.page.stop();
  expect(execute.mock.calls[0]?.[2].signal.aborted).toBe(true);
  finish("late");
  await pending;
  expect(owner.settle).not.toHaveBeenCalled();
});
