import { useChat } from "@ai-sdk/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UIMessageChunk } from "ai";
import { beforeEach, expect, test, vi } from "vitest";

import type { ChatUIMessage } from "../lib/chat-message";
import { useConversationChat } from "./useConversationChat";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  cancel: vi.fn(),
  reconnect: vi.fn(),
  select: vi.fn(),
  controller: null as ReadableStreamDefaultController<UIMessageChunk> | null,
  action: vi.fn(),
  send: vi.fn(),
  traceRunId: "run" as string | null,
  pending: null as { body: Record<string, unknown>; messages: ChatUIMessage[] } | null,
  retry: vi.fn(),
}));
vi.mock("@repo/api", () => ({
  fetchConversation: mocks.fetch,
  selectConversationHistory: mocks.select,
  cancelConversationAgentRun: mocks.cancel,
  authFetch: vi.fn(),
}));
vi.mock("@repo/design-system", () => ({ toast: { add: vi.fn() } }));
vi.mock("../lib/transport", () => ({
  createConversationTransport: () => ({
    reconnectToStream: mocks.reconnect,
    getPendingRequest: () => mocks.pending,
    prepareRetry: mocks.retry,
    clearPendingRequest: () => {
      mocks.pending = null;
    },
    sendMessages: (...args: unknown[]) => mocks.send(...args) as Promise<ReadableStream<UIMessageChunk>>,
  }),
}));
vi.mock("../store/useChatStore", () => {
  const store = {
    setTraceRun: mocks.action,
    clearTraceRun: mocks.action,
    bumpTraceRefresh: mocks.action,
    applyConversationTitle: mocks.action,
  };
  return {
    useChatStore: Object.assign((select: (s: typeof store) => unknown) => select(store), {
      getState: () => ({ ...store, traceRunId: mocks.traceRunId }),
    }),
  };
});
beforeEach(() => {
  mocks.controller = null;
  mocks.pending = null;
  mocks.traceRunId = "run";
  mocks.send.mockReset();
  mocks.send.mockImplementation(
    async () =>
      new ReadableStream<UIMessageChunk>({
        start(controller) {
          mocks.controller = controller;
        },
      }),
  );
  mocks.retry.mockReset();
  mocks.fetch.mockReset();
  mocks.reconnect.mockReset();
  mocks.fetch.mockResolvedValue({
    id: "one",
    title: "Conversation",
    messages: [],
    documents: [],
    active_run_id: null,
    revision: 0,
  });
  mocks.cancel.mockResolvedValue(undefined);
  mocks.reconnect.mockResolvedValue(null);
  mocks.select.mockReset();
});
async function mount() {
  const renders = vi.fn();
  const view = renderHook(() => {
    renders();
    return useConversationChat("one");
  });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(view.result.current.issue).toBeNull();
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
  await chunk({
    type: "tool-input-available",
    toolCallId: "ask",
    toolName: "ask_user",
    input: { question: "Which?" },
    toolMetadata: { agent: { execution: "client" } },
  });
  await chunk({ type: "finish" });
  await act(async () => {
    mocks.controller!.close();
    await sent!;
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(view.result.current.chat.messages.at(-1)?.parts).toContainEqual(
    expect.objectContaining({ toolCallId: "ask", state: "input-available" }),
  );
});

test("loading resumes a persisted run once; unmount disconnects without server cancellation", async () => {
  mocks.fetch.mockResolvedValue({ id: "one", revision: 1, messages: [], documents: [], active_run_id: "run" });
  const view = renderHook(() => {
    const owner = useConversationChat("one");
    useChat({
      chat: owner.chat,
      resume: !owner.loading && owner.detail?.id === "one" && Boolean(owner.detail.active_run_id),
    });
    return owner;
  });
  await waitFor(() => expect(mocks.reconnect).toHaveBeenCalledOnce());
  view.rerender();
  expect(mocks.reconnect).toHaveBeenCalledOnce();
  const stop = vi.spyOn(view.result.current.chat, "stop");
  view.unmount();
  expect(stop).toHaveBeenCalledOnce();
  expect(mocks.cancel).not.toHaveBeenCalled();
});

test("an idle hydrated conversation does not probe stream recovery", async () => {
  const view = renderHook(() => {
    const owner = useConversationChat("one");
    useChat({
      chat: owner.chat,
      resume: !owner.loading && owner.detail?.id === "one" && Boolean(owner.detail.active_run_id),
    });
    return owner;
  });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(mocks.reconnect).not.toHaveBeenCalled();
});

test("history mutations stay gated until the authoritative history validates", async () => {
  let resolveHistory!: (value: unknown) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveHistory = resolve;
    }),
  );
  const view = renderHook(() => useConversationChat("one"));
  expect(view.result.current.historyReady).toBe(false);
  expect(view.result.current.canStartHistoryMutation()).toBe(false);
  await act(async () => {
    resolveHistory({ id: "one", revision: 0, messages: [], documents: [], active_run_id: null });
  });
  await waitFor(() => expect(view.result.current.historyReady).toBe(true));
  expect(view.result.current.canStartHistoryMutation()).toBe(true);
});

test("invalid initial history keeps all history mutations gated", async () => {
  mocks.fetch.mockResolvedValue({
    id: "one",
    revision: 0,
    messages: [{ id: "bad", role: "user", content: { parts: [{ type: "text", text: 42 }] } }],
    documents: [],
    active_run_id: null,
  });
  const view = renderHook(() => useConversationChat("one"));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(view.result.current.historyReady).toBe(false);
  expect(view.result.current.canStartHistoryMutation()).toBe(false);
  expect(view.result.current.issue?.kind).toBe("history");
});

test("history hydration preserves message metadata", async () => {
  mocks.fetch.mockResolvedValue({
    id: "one",
    messages: [
      {
        id: "assistant",
        role: "assistant",
        status: "ok",
        created_at: "2026-11-10T00:00:00Z",
        content: {
          version: 2,
          parts: [{ type: "text", text: "answer" }],
          metadata: {
            runId: "run-one",
            providerId: "provider",
            model: "model",
            responseId: "response",
            parentResponseId: null,
            status: "completed",
            historyRevision: 3,
          },
        },
      },
    ],
    documents: [],
    active_run_id: null,
    revision: 3,
  });
  const view = await mount();
  expect(view.result.current.chat.messages[0]?.metadata).toEqual(
    expect.objectContaining({ runId: "run-one", responseId: "response", status: "completed" }),
  );
});

test("explicit stop cancels the server run and refreshes persisted messages", async () => {
  const view = await mount();
  const stop = vi.spyOn(view.result.current.chat, "stop");
  await act(async () => {
    await view.result.current.stopRun();
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(mocks.cancel).toHaveBeenCalledWith("one", "run", { skipErrorNotify: true });
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
});

test("stop discovers and cancels a run claimed before response headers arrived", async () => {
  mocks.traceRunId = null;
  const view = await mount();
  mocks.fetch
    .mockResolvedValueOnce({ id: "one", revision: 1, messages: [], documents: [], active_run_id: "server-run" })
    .mockResolvedValueOnce({ id: "one", revision: 1, messages: [], documents: [], active_run_id: null });
  await act(async () => {
    await view.result.current.stopRun();
  });
  expect(mocks.cancel).toHaveBeenCalledWith("one", "server-run", { skipErrorNotify: true });
});

test("server cancellation failure still disconnects the local stream", async () => {
  const view = await mount();
  mocks.cancel.mockRejectedValueOnce(new Error("offline"));
  const stop = vi.spyOn(view.result.current.chat, "stop");
  await act(async () => {
    await view.result.current.stopRun();
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

test("network disconnect preserves the partial reply and authoritative active run", async () => {
  const view = await mount();
  const chat = view.result.current.chat;
  let sent: Promise<void>;
  await act(async () => {
    sent = chat.sendMessage({ text: "hello" });
  });
  await chunk({ type: "start", messageId: "assistant" });
  await chunk({ type: "text-start", id: "text" });
  await chunk({ type: "text-delta", id: "text", delta: "partial answer" });
  mocks.fetch.mockResolvedValue({ id: "one", revision: 1, messages: [], documents: [], active_run_id: "run" });
  await act(async () => {
    mocks.controller!.error(new TypeError("fetch failed"));
    await sent!;
  });
  expect(chat.messages.at(-1)?.parts ?? []).toContainEqual(expect.objectContaining({ text: "partial answer" }));
  expect(view.result.current.detail?.active_run_id).not.toBeNull();
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

test("a delayed finish refresh cannot overwrite a newer local operation", async () => {
  const view = await mount();
  let resolveRefresh!: (value: unknown) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise((done) => {
      resolveRefresh = done;
    }),
  );
  const chat = view.result.current.chat;
  let first: Promise<void>;
  await act(async () => {
    first = chat.sendMessage({ text: "first" });
  });
  await chunk({ type: "start", messageId: "first-assistant" });
  await chunk({ type: "text-start", id: "first-text" });
  await chunk({ type: "text-delta", id: "first-text", delta: "first answer" });
  await chunk({ type: "text-end", id: "first-text" });
  await chunk({ type: "finish" });
  await act(async () => {
    mocks.controller!.close();
    await first!;
  });

  await act(async () => {
    void chat.sendMessage({ text: "second" });
  });
  const hasSecondMessage = () =>
    chat.messages.some((message) => message.parts.some((part) => part.type === "text" && part.text === "second"));
  await waitFor(() => expect(hasSecondMessage()).toBe(true));
  await act(async () => {
    resolveRefresh({
      id: "one",
      revision: 1,
      documents: [],
      active_run_id: null,
      messages: [
        {
          id: "first-user",
          role: "user",
          status: "ok",
          created_at: "2026-11-10T00:00:00Z",
          content: { version: 2, parts: [{ type: "text", text: "first" }] },
        },
      ],
    });
    await Promise.resolve();
  });

  expect(hasSecondMessage()).toBe(true);
});

test("history selection replaces the SDK snapshot without executing a run", async () => {
  mocks.fetch.mockResolvedValue({
    id: "one",
    title: "Conversation",
    revision: 3,
    messages: [],
    branches: [],
    documents: [],
    active_run_id: null,
  });
  mocks.select.mockResolvedValue({
    id: "one",
    title: "Conversation",
    revision: 4,
    messages: [
      {
        id: "candidate",
        role: "assistant",
        status: "ok",
        created_at: "2026-11-10T00:00:00Z",
        content: { version: 2, parts: [{ type: "text", text: "candidate answer" }] },
      },
    ],
    branches: [],
    documents: [],
    active_run_id: null,
  });
  const view = await mount();

  await act(async () => view.result.current.selectHistory("candidate-leaf"));

  expect(mocks.select).toHaveBeenCalledWith("one", { leaf_message_id: "candidate-leaf", expected_revision: 3 });
  expect(view.result.current.chat.messages[0]?.id).toBe("candidate");
  expect(mocks.controller).toBeNull();
});

test("a delayed history selection cannot overwrite a newer local run", async () => {
  mocks.fetch.mockResolvedValue({
    id: "one",
    title: "Conversation",
    revision: 3,
    messages: [],
    branches: [],
    documents: [],
    active_run_id: null,
  });
  let resolveSelection!: (value: unknown) => void;
  mocks.select.mockReturnValue(
    new Promise((resolve) => {
      resolveSelection = resolve;
    }),
  );
  const view = await mount();
  let selection: Promise<void>;
  await act(async () => {
    selection = view.result.current.selectHistory("old-leaf");
    void view.result.current.chat.sendMessage({ text: "new operation" });
  });
  await act(async () => {
    resolveSelection({
      id: "one",
      revision: 4,
      messages: [],
      branches: [],
      documents: [],
      active_run_id: null,
    });
    await selection!;
  });

  expect(
    view.result.current.chat.messages.some((message) =>
      message.parts.some((part) => part.type === "text" && part.text === "new operation"),
    ),
  ).toBe(true);
});

test("a pending history selection gates mutations and cannot replace a changed local snapshot", async () => {
  mocks.fetch.mockResolvedValue({
    id: "one",
    title: "Conversation",
    revision: 3,
    messages: [],
    branches: [],
    documents: [],
    active_run_id: null,
  });
  let resolveSelection!: (value: unknown) => void;
  mocks.select.mockReturnValue(
    new Promise((resolve) => {
      resolveSelection = resolve;
    }),
  );
  const view = await mount();
  let selection!: Promise<void>;
  await act(async () => {
    selection = view.result.current.selectHistory("old-leaf");
  });
  expect(view.result.current.historyMutationPending).toBe(true);
  expect(view.result.current.canStartHistoryMutation()).toBe(false);
  view.result.current.chat.messages = [{ id: "local", role: "user", parts: [{ type: "text", text: "new" }] }];
  await act(async () => {
    resolveSelection({
      id: "one",
      revision: 4,
      messages: [],
      branches: [],
      documents: [],
      active_run_id: null,
    });
    await selection;
  });
  expect(view.result.current.chat.messages[0]?.id).toBe("local");
  expect(view.result.current.historyMutationPending).toBe(false);
});

test("cancellation remains unconfirmed until the server reports a terminal run", async () => {
  const view = await mount();
  mocks.cancel.mockResolvedValueOnce({ cancelled: false, status: "cancel_requested" });
  await act(async () => view.result.current.stopRun());
  expect(view.result.current.issue?.kind).toBe("cancel");
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  mocks.cancel.mockResolvedValueOnce({ cancelled: true, status: "cancelled" });
  await act(async () => view.result.current.stopRun());
  expect(view.result.current.issue).toBeNull();
});

test("a malformed history refresh preserves the valid SDK message snapshot", async () => {
  const view = await mount();
  view.result.current.chat.messages = [{ id: "user", role: "user", parts: [{ type: "text", text: "keep me" }] }];
  mocks.fetch.mockResolvedValue({
    id: "one",
    revision: 0,
    messages: [{ id: "user", role: "user", content: { parts: [{ type: "text", text: 42 }] } }],
    documents: [],
    active_run_id: null,
  });
  await act(async () => view.result.current.recover());
  expect(view.result.current.chat.messages[0]?.parts).toEqual([{ type: "text", text: "keep me" }]);
  expect(view.result.current.issue).not.toBeNull();
});

test("retry recovers an already claimed operation without sending another POST", async () => {
  const view = await mount();
  mocks.pending = { body: { expected_revision: 0, request_id: "original" }, messages: [] };
  mocks.fetch.mockResolvedValue({
    id: "one",
    revision: 1,
    active_run_id: null,
    messages: [{ id: "saved", role: "assistant", content: { parts: [{ type: "text", text: "saved answer" }] } }],
    documents: [],
  });
  await act(async () => view.result.current.retryRequest());
  expect(mocks.retry).not.toHaveBeenCalled();
  expect(mocks.controller).toBeNull();
  expect(view.result.current.chat.messages[0]?.id).toBe("saved");
});

test("concurrent retry clicks consume one authoritative replay path", async () => {
  const view = await mount();
  mocks.pending = { body: { expected_revision: 0, request_id: "original" }, messages: [] };
  let resolveProbe!: (value: unknown) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveProbe = resolve;
    }),
  );
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = view.result.current.retryRequest();
    second = view.result.current.retryRequest();
  });
  expect(view.result.current.canRetry).toBe(false);
  await act(async () => {
    resolveProbe({ id: "one", revision: 1, active_run_id: "run", messages: [], documents: [] });
    await Promise.all([first, second]);
  });
  expect(mocks.reconnect).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
});

test("a client answer entered before the stream ends still triggers exactly one SDK continuation", async () => {
  const view = await mount();
  const chat = view.result.current.chat;
  let sent!: Promise<void>;
  await act(async () => {
    sent = chat.sendMessage({ text: "question" });
  });
  const first = mocks.controller!;
  await chunk({ type: "start", messageId: "assistant" });
  await chunk({ type: "start-step" });
  await chunk({
    type: "tool-input-available",
    toolCallId: "ask",
    toolName: "ask_user",
    input: {},
    toolMetadata: { agent: { execution: "client" } },
  });
  await act(async () => {
    view.result.current.pendingClientContinuationRef.current = true;
    void chat.addToolOutput({ tool: "ask_user", toolCallId: "ask", output: { answer: "yes" } });
  });
  await chunk({ type: "finish-step" });
  await chunk({ type: "finish", finishReason: "tool-calls" });
  await act(async () => {
    first.close();
  });
  await waitFor(() => expect(mocks.controller).not.toBe(first));
  await chunk({ type: "start", messageId: "assistant" });
  await chunk({ type: "start-step" });
  await chunk({ type: "text-start", id: "result" });
  await chunk({ type: "text-delta", id: "result", delta: "done" });
  await chunk({ type: "text-end", id: "result" });
  await chunk({ type: "finish-step" });
  await chunk({ type: "finish", finishReason: "stop" });
  await act(async () => {
    mocks.controller!.close();
    await sent;
  });
  expect(chat.status).toBe("ready");
});
