import { act, renderHook, waitFor } from "@testing-library/react";
import type { UIMessageChunk } from "ai";
import { beforeEach, expect, test, vi } from "vitest";

import { useConversationChat } from "./useConversationChat";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  cancel: vi.fn(),
  reconnect: vi.fn(),
  controller: null as ReadableStreamDefaultController<UIMessageChunk> | null,
  action: vi.fn(),
}));
vi.mock("@repo/api", () => ({
  fetchConversation: mocks.fetch,
  cancelConversationAgentRun: mocks.cancel,
  authFetch: vi.fn(),
}));
vi.mock("@repo/design-system", () => ({ toast: { add: vi.fn() } }));
vi.mock("../lib/transport", () => ({
  createConversationTransport: () => ({
    reconnectToStream: mocks.reconnect,
    sendMessages: async () =>
      new ReadableStream<UIMessageChunk>({
        start(controller) {
          mocks.controller = controller;
        },
      }),
  }),
}));
vi.mock("../store/useChatStore", () => {
  const store = {
    traceRunId: "run",
    setTraceRun: mocks.action,
    clearTraceRun: mocks.action,
    bumpTraceRefresh: mocks.action,
    applyConversationTitle: mocks.action,
  };
  return {
    useChatStore: Object.assign((select: (s: typeof store) => unknown) => select(store), { getState: () => store }),
  };
});
beforeEach(() => {
  mocks.controller = null;
  mocks.fetch.mockResolvedValue({ id: "one", title: "Conversation", messages: [], documents: [], active_run_id: null });
  mocks.cancel.mockResolvedValue(undefined);
  mocks.reconnect.mockResolvedValue(null);
});
async function mount() {
  const renders = vi.fn();
  const view = renderHook(() => {
    renders();
    return useConversationChat("one");
  });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  renders.mockClear();
  return { ...view, renders };
}
async function chunk(value: UIMessageChunk) {
  await act(async () => {
    mocks.controller!.enqueue(value);
  });
}

test("real SDK text deltas update the Chat instance without rendering its owner", async () => {
  const view = await mount();
  const chat = view.result.current.chat;
  let sent: Promise<void>;
  await act(async () => {
    sent = chat.sendMessage({ text: "hello" });
  });
  await chunk({ type: "start", messageId: "assistant" });
  await chunk({ type: "text-start", id: "text" });
  for (let i = 0; i < 10; i++) await chunk({ type: "text-delta", id: "text", delta: "token" });
  expect(chat.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ text: "token".repeat(10) }));
  expect(view.renders).not.toHaveBeenCalled();
  expect(view.result.current.chat).toBe(chat);
  await chunk({ type: "text-end", id: "text" });
  await chunk({ type: "finish" });
  await act(async () => {
    mocks.controller!.close();
    await sent!;
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

test("client-tool pauses keep the live tool part instead of reloading stored messages", async () => {
  const view = await mount();
  let sent: Promise<void>;
  await act(async () => {
    sent = view.result.current.chat.sendMessage({ text: "question" });
  });
  await chunk({ type: "start", messageId: "assistant" });
  await chunk({ type: "tool-input-available", toolCallId: "ask", toolName: "ask_user", input: { question: "Which?" } });
  await chunk({ type: "finish" });
  await act(async () => {
    mocks.controller!.close();
    await sent!;
  });
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(view.result.current.chat.messages.at(-1)?.parts).toContainEqual(
    expect.objectContaining({ toolCallId: "ask", state: "input-available" }),
  );
});

test("loading resumes a persisted run once; unmount disconnects without server cancellation", async () => {
  mocks.fetch.mockResolvedValue({ id: "one", messages: [], documents: [], active_run_id: "run" });
  const view = await mount();
  await waitFor(() => expect(mocks.reconnect).toHaveBeenCalledOnce());
  view.rerender();
  expect(mocks.reconnect).toHaveBeenCalledOnce();
  const stop = vi.spyOn(view.result.current.chat, "stop");
  view.unmount();
  expect(stop).toHaveBeenCalledOnce();
  expect(mocks.cancel).not.toHaveBeenCalled();
});

test("explicit stop cancels the server run and refreshes persisted messages", async () => {
  const view = await mount();
  const stop = vi.spyOn(view.result.current.chat, "stop");
  await act(async () => {
    await view.result.current.stopRun();
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(mocks.cancel).toHaveBeenCalledWith("one", "run");
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

test("server cancellation failure still disconnects the local stream", async () => {
  const view = await mount();
  mocks.cancel.mockRejectedValueOnce(new Error("offline"));
  const stop = vi.spyOn(view.result.current.chat, "stop");
  await act(async () => {
    await view.result.current.stopRun();
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

test("a delayed persistence refresh cannot replace a disconnected Chat's messages", async () => {
  const view = await mount();
  let resolve!: (value: unknown) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const chat = view.result.current.chat;
  let sent: Promise<void>;
  await act(async () => {
    sent = chat.sendMessage({ text: "hello" });
  });
  await chunk({ type: "start", messageId: "assistant" });
  await chunk({ type: "text-start", id: "text" });
  await chunk({ type: "text-delta", id: "text", delta: "live" });
  await chunk({ type: "text-end", id: "text" });
  await chunk({ type: "finish" });
  await act(async () => {
    mocks.controller!.close();
    await sent!;
  });
  view.unmount();
  await act(async () => {
    resolve({ id: "one", messages: [], documents: [] });
  });
  expect(chat.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ text: "live" }));
});
