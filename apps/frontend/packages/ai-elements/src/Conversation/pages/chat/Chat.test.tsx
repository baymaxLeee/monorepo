import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { Suspense, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ChatMessageViewProps } from "../../components/ChatMessageView";
import type * as ConversationModule from "../../hooks/useConversationChat";
import { ChatSession } from "./Chat";

const state = vi.hoisted(() => ({
  messages: [] as UIMessage[],
  status: "streaming",
  composerRenders: 0,
  conversationRenders: 0,
  sessionRenders: 0,
  listeners: new Set<() => void>(),
  messageRenders: [] as string[],
  rowRenders: [] as string[],
  sendMessage: vi.fn(),
  editMessage: undefined as ChatMessageViewProps["onEditMessage"],
  setMessages: vi.fn(),
  stop: vi.fn(),
  resumeStream: vi.fn(),
  addToolOutput: vi.fn(),
  addToolApprovalResponse: vi.fn(),
  cancel: vi.fn(),
  submitInput: vi.fn(),
  getInput: vi.fn(),
  listInputs: vi.fn(),
  promptClear: vi.fn(),
  action: vi.fn(),
  updateModel: vi.fn(),
  updatePolicy: vi.fn(),
  documents: [] as unknown[],
  suspendedText: null as string | null,
  pendingRender: new Promise<void>(() => {}),
  serverActiveRunId: "run" as string | null,
}));

vi.mock("@ai-sdk/react", async () => {
  const { useEffect, useReducer } = await import("react");
  return {
    Chat: vi.fn(function () {
      return state;
    }),
    useChat: () => {
      const [, redraw] = useReducer((count: number) => count + 1, 0);
      useEffect(() => {
        state.listeners.add(redraw);
        return () => {
          state.listeners.delete(redraw);
        };
      }, []);
      return { messages: state.messages, status: state.status };
    },
  };
});
vi.mock("../../hooks/useConversationChat", async (importOriginal) => {
  const actual = await importOriginal<typeof ConversationModule>();
  return {
    useConversationChat: (id: string) => {
      state.sessionRenders++;
      return actual.useConversationChat(id);
    },
  };
});
vi.mock("@repo/api", () => ({
  authFetch: vi.fn(),
}));
vi.mock("@repo/api/chat", () => ({
  cancelConversationAgentRun: state.cancel,
  submitConversationAgentRunInput: state.submitInput,
  getConversationAgentRunInput: state.getInput,
  listConversationAgentRunInputs: state.listInputs,
  getConversation: async () => ({
    id: "conversation",
    title: "Test",
    revision: 0,
    active_run_id: state.serverActiveRunId,
    latest_run_id: "run",
    provider_id: "provider",
    model: "model",
    reasoning_effort: "medium",
    approval_policy: "on-request",
    permission_profile: ":workspace",
    documents: state.documents,
    messages: state.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: { parts: message.parts },
    })),
  }),
  updateConversationModel: state.updateModel,
  updateConversationExecutionPolicy: state.updatePolicy,
}));
vi.mock("@repo/api/admin", () => ({
  listProviders: vi.fn(async () => [
    { id: "provider", name: "Model", model: "model", provider_kind: "chat", is_enabled: true },
  ]),
  listSkills: vi.fn(async () => []),
}));
vi.mock("@repo/api/knowledge", () => ({ ingestDocuments: vi.fn(), prepareIngest: vi.fn() }));
vi.mock("../../lib/transport", () => ({ createConversationTransport: vi.fn(() => ({})) }));
vi.mock("../../store/useChatStore", () => {
  const store = {
    traceRefreshKey: 0,
    traceRunId: "run",
    setTraceRun: state.action,
    clearTraceRun: state.action,
    bumpTraceRefresh: state.action,
    openArtifactPreview: state.action,
    openFilePreview: state.action,
    closeArtifactPreview: state.action,
    closeImagePreview: state.action,
    applyConversationTitle: state.action,
  };
  return {
    useChatStore: Object.assign((select: (value: typeof store) => unknown) => select(store), { getState: () => store }),
  };
});
vi.mock("@repo/ai-elements", () => ({
  Conversation: ({ children }: { children: ReactNode }) => {
    state.conversationRenders++;
    return <div>{children}</div>;
  },
  ConversationContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConversationEmptyState: () => null,
  ConversationScrollButton: () => null,
}));
vi.mock("@repo/design-system", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  MessageScrollerItem: ({ children, messageId }: { children: ReactNode; messageId?: string }) => {
    if (messageId) state.rowRenders.push(messageId);
    return <div>{children}</div>;
  },
  Spinner: () => null,
  toast: { add: vi.fn() },
}));
vi.mock("../../components/ChatMessageView", () => ({
  ChatMessageView: ({
    message,
    onToolApproval,
    busy,
    onEditMessage,
  }: {
    message: UIMessage;
    onToolApproval: (id: string, approved: boolean) => void;
    busy: boolean;
    onEditMessage: ChatMessageViewProps["onEditMessage"];
  }) => {
    state.editMessage = onEditMessage;
    state.messageRenders.push(message.id);
    const text = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    if (text === state.suspendedText) throw state.pendingRender;
    return (
      <div data-testid={message.id} data-busy={busy}>
        {text}
        <button onClick={() => onToolApproval("approval", true)}>授权</button>
      </div>
    );
  },
}));
vi.mock("../../components/ChatImagePreview", () => ({ ChatImagePreview: () => null }));
vi.mock("../../components/ChatComposerControls", () => ({
  ChatComposerControls: () => null,
}));
vi.mock("../../components/ChatContextUsage", () => ({ ChatContextUsage: () => null }));
vi.mock("../../components/ExecutionPolicy", () => ({ ExecutionPolicy: () => null }));
vi.mock("@repo/ai-elements/prompt-input", () => ({
  PromptInput: ({
    ref,
    onStop,
    onSubmit,
    loading,
    submitWhileLoading,
    footerStartRender,
    footerEndRender,
  }: {
    ref?: { current: unknown };
    onStop: () => void;
    onSubmit: (value: {
      text: string;
      segments: Array<{ type: "text"; text: string }>;
      tokens: [];
      files: Record<string, File>;
    }) => void;
    loading: boolean;
    submitWhileLoading?: boolean;
    footerStartRender: () => ReactNode;
    footerEndRender: () => ReactNode;
  }) => {
    state.composerRenders++;
    if (ref)
      ref.current = {
        clear: state.promptClear,
        setValue: vi.fn(),
        getValue: () => ({ text: "补充输入", segments: [], tokens: [], files: {} }),
      };
    return (
      <>
        <input aria-label="下一条消息" data-loading={loading} data-submit-while-loading={submitWhileLoading} />
        <button
          onClick={() =>
            onSubmit({
              text: "补充输入",
              segments: [{ type: "text", text: "补充输入" }],
              tokens: [],
              files: {},
            })
          }
        >
          发送补充
        </button>
        <button onClick={onStop}>停止</button>
        {footerStartRender()}
        {footerEndRender()}
      </>
    );
  },
}));

beforeEach(() => {
  state.messages = [{ id: "live", role: "assistant", parts: [{ type: "text", text: "输出" }] }];
  state.status = "streaming";
  state.composerRenders = 0;
  state.conversationRenders = 0;
  state.messageRenders = [];
  state.rowRenders = [];
  state.suspendedText = null;
  state.editMessage = undefined;
  state.submitInput.mockReset();
  state.getInput.mockReset();
  state.listInputs.mockReset();
  state.listInputs.mockResolvedValue([]);
  state.promptClear.mockReset();
  state.sendMessage.mockReset();
  state.sendMessage.mockResolvedValue(undefined);
  state.serverActiveRunId = "run";
});

afterEach(() => vi.unstubAllGlobals());

async function mount() {
  const view = render(
    <MemoryRouter>
      <ChatSession conversationId="conversation" />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText("Test")).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId(state.messages.at(-1)!.id)).toBeTruthy());
  state.composerRenders = 0;
  state.conversationRenders = 0;
  state.messageRenders = [];
  state.rowRenders = [];
  state.sessionRenders = 0;
  return view;
}

test("first request preserves composer parts after conversation creation", async () => {
  state.status = "ready";
  state.serverActiveRunId = null;
  const parts = [
    { type: "file" as const, mediaType: "text/markdown", filename: "brief.md", url: "/brief.md" },
    { type: "text" as const, text: "summarize" },
  ];

  render(
    <MemoryRouter>
      <ChatSession conversationId="conversation" externalRequest={{ id: "initial-request", parts }} />
    </MemoryRouter>,
  );

  await waitFor(() => expect(state.sendMessage).toHaveBeenCalledWith({ parts }, { body: {} }));
});

test("editing a message on HTTP preserves its target and generates a new message id", async () => {
  vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  state.status = "ready";
  state.messages = [{ id: "original-user", role: "user", parts: [{ type: "text", text: "original" }] }];
  await mount();
  const parts = [{ type: "text" as const, text: "edited" }];
  await act(async () => state.editMessage!("original-user", parts));
  expect(state.sendMessage).toHaveBeenCalledWith(
    { id: expect.stringMatching(/^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/), messageId: "original-user", parts },
    { body: {} },
  );
});

test("text deltas do not rerender the composer, and typing/stop remain available", async () => {
  await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "正在编辑的下一条消息" } });
  for (let i = 0; i < 20; i++) {
    state.messages = [{ id: "live", role: "assistant", parts: [{ type: "text", text: `输出 ${i}` }] }];
    await publish();
  }
  expect(screen.getByText("输出 19")).toBeTruthy();
  expect(state.composerRenders).toBe(0);
  expect(state.conversationRenders).toBe(0);
  expect(state.sessionRenders).toBe(0);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("正在编辑的下一条消息");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "停止" })));
  expect(state.stop).toHaveBeenCalledOnce();
  expect(state.cancel).toHaveBeenCalledWith("conversation", "run", { skipErrorNotify: true });
});

test("a published text delta is deferred outside the transport commit", async () => {
  await mount();
  state.messages = [{ id: "live", role: "assistant", parts: [{ type: "text", text: "实时增量" }] }];
  flushSync(() => state.listeners.forEach((notify) => notify()));
  expect(screen.queryByText("实时增量")).toBeNull();
  expect(await screen.findByText("实时增量")).toBeTruthy();
});

test("a running submission clears only after durable admission and renders in the transcript", async () => {
  let admit: (value: unknown) => void = () => {};
  state.submitInput.mockReturnValue(
    new Promise((resolve) => {
      admit = resolve;
    }),
  );
  state.getInput.mockResolvedValue({
    clientMessageId: "client-message",
    runId: "run",
    mode: "follow-up",
    text: "补充输入",
    state: "accepted",
    stepNumber: null,
    reason: null,
  });
  await mount();
  expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "发送补充" }));
  await waitFor(() => expect(state.submitInput).toHaveBeenCalledOnce());
  expect(state.promptClear).not.toHaveBeenCalled();
  admit({
    clientMessageId: "client-message",
    runId: "run",
    mode: "follow-up",
    text: "补充输入",
    state: "accepted",
    stepNumber: null,
    reason: null,
  });
  await waitFor(() => expect(state.promptClear).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("待发送消息").textContent).toContain("补充输入");
  expect(screen.getByLabelText("待发送消息").textContent).toContain("等待当前步骤结束后加入");
  expect(screen.getByRole("textbox").getAttribute("data-submit-while-loading")).toBe("true");
  expect(state.submitInput).toHaveBeenCalledWith(
    "conversation",
    "run",
    {
      expected_run_id: "run",
      client_message_id: expect.stringMatching(/^[0-9a-f]{32}$/),
      text: "补充输入",
      mode: "follow-up",
    },
    { skipErrorNotify: true },
  );

  state.messages = [
    {
      id: "assistant",
      role: "assistant",
      parts: [
        {
          type: "steering-message",
          id: "client-message",
          parts: [{ type: "text", text: "补充输入" }],
        },
      ],
    },
  ];
  await publish();
  expect(screen.queryByLabelText("待发送消息")).toBeNull();
});

test("a recovered not-delivered supplement stays visible and never starts another turn automatically", async () => {
  state.status = "ready";
  state.serverActiveRunId = null;
  state.listInputs.mockResolvedValue([
    {
      clientMessageId: "client-message",
      runId: "run",
      mode: "follow-up",
      text: "恢复后的补充",
      state: "not_delivered",
      stepNumber: null,
      reason: "finished",
    },
  ]);
  await mount();
  await waitFor(() => expect(screen.getByLabelText("待发送消息").textContent).toContain("恢复后的补充"));
  expect(screen.getByLabelText("待发送消息").textContent).toContain("未加入当前任务");
  expect(state.sendMessage).not.toHaveBeenCalled();
});

test("a live text delta does not render unchanged historical messages", async () => {
  const history: UIMessage[] = Array.from({ length: 30 }, (_, i) => ({
    id: `history-${i}`,
    role: "assistant",
    parts: [{ type: "text", text: `历史 ${i}` }],
  }));
  state.messages = [...history, ...state.messages];
  await mount();
  // Let conversation hydration and composer-side model discovery settle, then
  // measure only the render caused by the live SDK snapshot below.
  await publish();
  state.messageRenders = [];
  state.rowRenders = [];
  state.messages = [
    ...state.messages.slice(0, -1),
    { id: "live", role: "assistant", parts: [{ type: "text", text: "新内容" }] },
  ];
  await publish();
  expect(screen.getByText("新内容")).toBeTruthy();
  expect(state.messageRenders).toEqual(["live"]);
  expect(state.rowRenders).toEqual(["live"]);
});

test("ready status and changed request options reach memoized controls and tool actions", async () => {
  await mount();
  expect(screen.queryByText("云端")).toBeNull();
  expect(screen.getByRole("textbox").getAttribute("data-loading")).toBe("true");
  state.status = "ready";
  await publish();
  expect(screen.getByRole("textbox").getAttribute("data-loading")).toBe("false");
  expect(screen.getByTestId("live").getAttribute("data-busy")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "授权" }));
  expect(state.addToolApprovalResponse).toHaveBeenCalledWith({
    id: "approval",
    approved: true,
    options: { body: {} },
  });
});

test("a suspended transcript update does not block edits or cancellation", async () => {
  render(
    <MemoryRouter>
      <Suspense fallback={<div>正文加载中</div>}>
        <ChatSession conversationId="conversation" />
      </Suspense>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText("Test")).toBeTruthy());
  state.suspendedText = "尚未渲染的增量";
  state.messages = [{ id: "live", role: "assistant", parts: [{ type: "text", text: state.suspendedText }] }];
  await publish();
  expect(screen.queryByText("正文加载中")).toBeNull();
  expect(screen.getByText("输出")).toBeTruthy();
  expect(screen.queryByText("正在更新消息…")).toBeNull();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "仍然可以编辑" } });
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("仍然可以编辑");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "停止" })));
  expect(state.cancel).toHaveBeenCalledWith("conversation", "run", { skipErrorNotify: true });
});

async function publish() {
  await act(async () => {
    state.listeners.forEach((notify) => notify());
  });
}

test("history is revealed incrementally and appending a turn retains the reading anchor", async () => {
  state.messages = Array.from({ length: 100 }, (_, index) => ({
    id: `history-${index}`,
    role: "assistant",
    parts: [{ type: "text", text: `row ${index}` }],
  }));
  await mount();
  expect(screen.queryByTestId("history-59")).toBeNull();
  expect(screen.getByTestId("history-60")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "显示更早的消息" }));
  expect(screen.getByTestId("history-20")).toBeTruthy();
  state.messages = [...state.messages, { id: "new-turn", role: "user", parts: [{ type: "text", text: "next" }] }];
  await publish();
  expect(screen.getByTestId("history-20")).toBeTruthy();
  expect(screen.getByTestId("new-turn")).toBeTruthy();
});
