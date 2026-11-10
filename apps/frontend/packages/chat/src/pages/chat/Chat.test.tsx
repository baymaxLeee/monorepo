import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { Suspense, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

import type * as ConversationModule from "../../hooks/useConversationChat";
import { ChatSession } from "./Chat";

const state = vi.hoisted(() => ({
  messages: [] as UIMessage[],
  status: "streaming",
  composerRenders: 0,
  sessionRenders: 0,
  listeners: new Set<() => void>(),
  messageRenders: [] as string[],
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  stop: vi.fn(),
  resumeStream: vi.fn(),
  addToolOutput: vi.fn(),
  addToolApprovalResponse: vi.fn(),
  cancel: vi.fn(),
  action: vi.fn(),
  loadAgents: vi.fn(),
  documents: [] as unknown[],
  suspendedText: null as string | null,
  pendingRender: new Promise<void>(() => {}),
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
  cancelConversationAgentRun: state.cancel,
  fetchBotSkills: vi.fn(),
  ingestConversationDocuments: vi.fn(),
  fetchConversation: async () => ({
    id: "conversation",
    title: "Test",
    documents: state.documents,
    messages: state.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: { parts: message.parts },
    })),
  }),
}));
vi.mock("../../lib/transport", () => ({ createConversationTransport: vi.fn(() => ({})) }));
vi.mock("../../store/useChatStore", () => {
  const store = {
    agents: [],
    selectedAgentId: null,
    traceRefreshKey: 0,
    traceRunId: "run",
    loadAgents: state.loadAgents,
    setSelectedAgentId: state.action,
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
  Conversation: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConversationContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConversationEmptyState: () => null,
  ConversationScrollButton: () => null,
}));
vi.mock("@repo/design-system", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  MessageScrollerItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Spinner: () => null,
  toast: { add: vi.fn() },
}));
vi.mock("../../components/ChatTodoListCard", () => ({
  findLatestUpdateTodosCallId: () => null,
  collectDeliverableCompletion: () => ({ artifact: [], image: [], video: [] }),
}));
vi.mock("../../components/ChatMessageView", () => ({
  ChatMessageView: ({
    message,
    onToolApproval,
    planExecutedIds,
    planBusy,
  }: {
    message: UIMessage;
    onToolApproval: (id: string, approved: boolean) => void;
    planExecutedIds: ReadonlySet<string>;
    planBusy: boolean;
  }) => {
    state.messageRenders.push(message.id);
    const text = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    if (text === state.suspendedText) throw state.pendingRender;
    return (
      <div data-testid={message.id} data-plans={[...planExecutedIds].join(",")} data-busy={planBusy}>
        {text}
        <button onClick={() => onToolApproval("approval", true)}>授权</button>
      </div>
    );
  },
}));
vi.mock("../../components/ChatImagePreview", () => ({ ChatImagePreview: () => null }));
vi.mock("../../components/ChatComposerControls", () => ({
  ChatComposerControls: ({ onModeChange, disabled }: { onModeChange: (mode: "plan") => void; disabled: boolean }) => (
    <button disabled={disabled} onClick={() => onModeChange("plan")}>
      切换模式
    </button>
  ),
}));
vi.mock("../../components/ChatContextUsage", () => ({ ChatContextUsage: () => null }));
vi.mock("@repo/ai-elements/prompt-input", () => ({
  PromptInput: ({
    onStop,
    loading,
    footerRender,
  }: {
    onStop: () => void;
    loading: boolean;
    footerRender: () => ReactNode;
  }) => {
    state.composerRenders++;
    return (
      <>
        <input aria-label="下一条消息" data-loading={loading} />
        <button onClick={onStop}>停止</button>
        {footerRender()}
      </>
    );
  },
}));

beforeEach(() => {
  state.messages = [{ id: "live", role: "assistant", parts: [{ type: "text", text: "输出" }] }];
  state.status = "streaming";
  state.composerRenders = 0;
  state.messageRenders = [];
  state.suspendedText = null;
});

async function mount() {
  const view = render(
    <MemoryRouter>
      <ChatSession conversationId="conversation" />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText("Test")).toBeTruthy());
  state.composerRenders = 0;
  state.messageRenders = [];
  state.sessionRenders = 0;
  return view;
}

test("text deltas do not rerender the composer, and typing/stop remain available", async () => {
  await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "正在编辑的下一条消息" } });
  for (let i = 0; i < 20; i++) {
    state.messages = [{ id: "live", role: "assistant", parts: [{ type: "text", text: `输出 ${i}` }] }];
    await publish();
  }
  expect(screen.getByText("输出 19")).toBeTruthy();
  expect(state.composerRenders).toBe(0);
  expect(state.sessionRenders).toBe(0);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("正在编辑的下一条消息");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "停止" })));
  expect(state.stop).toHaveBeenCalledOnce();
  expect(state.cancel).toHaveBeenCalledWith("conversation", "run", { skipErrorNotify: true });
});

test("a live text delta does not render unchanged historical messages", async () => {
  const history: UIMessage[] = Array.from({ length: 30 }, (_, i) => ({
    id: `history-${i}`,
    role: "assistant",
    parts: [{ type: "text", text: `历史 ${i}` }],
  }));
  state.messages = [...history, ...state.messages];
  await mount();
  state.messages = [
    ...state.messages.slice(0, -1),
    { id: "live", role: "assistant", parts: [{ type: "text", text: "新内容" }] },
  ];
  await publish();
  expect(screen.getByText("新内容")).toBeTruthy();
  expect(state.messageRenders).toEqual(["live"]);
});

test("ready status and changed request options reach memoized controls and tool actions", async () => {
  await mount();
  expect(screen.getByRole("textbox").getAttribute("data-loading")).toBe("true");
  state.status = "ready";
  await publish();
  expect(screen.getByRole("textbox").getAttribute("data-loading")).toBe("false");
  expect(screen.getByTestId("live").getAttribute("data-busy")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "切换模式" }));
  fireEvent.click(screen.getByRole("button", { name: "授权" }));
  expect(state.addToolApprovalResponse).toHaveBeenCalledWith({
    id: "approval",
    approved: true,
    options: { body: { agent_id: null, mode: "plan" } },
  });
});

test("plan execution context still updates an unchanged historical row", async () => {
  const history = state.messages[0];
  await mount();
  state.messages = [
    history,
    { id: "execution", role: "user", parts: [{ type: "data-plan-execution", data: { path: "plan.md" } }] },
  ];
  await publish();
  expect(screen.getByTestId("live").getAttribute("data-plans")).toBe("plan.md");
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
