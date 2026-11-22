import type * as ConversationModule from "@repo/ai-elements/conversation";
import type { PromptInputRef, PromptInputValue } from "@repo/ai-elements/prompt-input";
import type { DesktopBridge, DesktopEvent, LocalStream, LocalThread } from "@repo/runtime/desktop";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import { LocalSession } from "./LocalSession";
import { LocalChatTransport } from "./transport";

const promptValue: PromptInputValue = {
  text: "创建文件",
  segments: [{ type: "text", text: "创建文件" }],
  tokens: [],
  files: {},
};
const promptApi = vi.hoisted(() => ({
  clear: vi.fn(),
  setValue: vi.fn(),
  getValue: vi.fn(() => ({
    text: "创建文件",
    segments: [{ type: "text" as const, text: "创建文件" }],
    tokens: [],
    files: {},
  })),
}));
const sessionViewApi = vi.hoisted(() => ({
  chat: null as { resumeStream(): Promise<void> } | null,
  runActive: false,
}));

vi.mock("@repo/ai-elements", () => ({
  ContextUsage: ({ value }: { value?: LocalThread["contextUsage"] }) => (
    <span data-testid="local-context-usage">
      {value ? `${value.usedTokens}:${value.estimated ? "estimated" : "confirmed"}` : "empty"}
    </span>
  ),
}));
vi.mock("@repo/api/chat", () => ({
  getLocalInferenceConfig: vi.fn(async () => ({
    providerId: "provider",
    providerName: "baymax",
    reasoningEffort: "medium",
    model: "test-model",
    contextWindow: 100_000,
    maxOutputTokens: 4000,
    instructions: "",
  })),
}));
vi.mock("@repo/api/admin", () => ({
  listProviders: vi.fn(async () => [
    { id: "provider", name: "baymax", model: "test-model", provider_kind: "chat", is_enabled: true },
  ]),
}));
vi.mock("@repo/ai-elements/conversation", async (importOriginal) => ({
  ...(await importOriginal<typeof ConversationModule>()),
  ConversationSessionView: ({
    chat,
    composer,
    issue,
    onToolApproval,
    runActive,
  }: {
    chat: { resumeStream(): Promise<void> };
    composer: (activePlan: null) => ReactNode;
    issue: ReactNode;
    onToolApproval: (id: string, approved: boolean) => void;
    runActive?: boolean;
  }) => {
    sessionViewApi.chat = chat;
    sessionViewApi.runActive = Boolean(runActive);
    return (
      <div>
        {issue}
        {composer(null)}
        <button onClick={() => onToolApproval("approval", true)}>共享授权</button>
      </div>
    );
  },
  ChatPrompt: ({
    ref,
    placeholder,
    loading,
    submitWhileLoading,
    onSubmit,
    onStop,
    footerStartRender,
    footerEndRender,
  }: {
    ref: Ref<PromptInputRef>;
    placeholder: string;
    loading?: boolean;
    submitWhileLoading?: boolean;
    onSubmit: (value: PromptInputValue) => void;
    onStop?: () => void;
    footerStartRender: () => ReactNode;
    footerEndRender: () => ReactNode;
  }) => {
    const api = promptApi as unknown as PromptInputRef;
    if (typeof ref === "function") ref(api);
    else if (ref) ref.current = api;
    return (
      <div>
        <span>{placeholder}</span>
        <span data-testid="composer-loading">{String(Boolean(loading))}</span>
        <span data-testid="submit-while-loading">{String(Boolean(submitWhileLoading))}</span>
        {footerStartRender()}
        {footerEndRender()}
        <button onClick={() => onSubmit(promptValue)}>发送测试</button>
        <button onClick={onStop}>停止测试</button>
      </div>
    );
  },
  ChatComposerControls: ({
    models,
    onSelectModel,
    onReasoningEffortChange,
  }: {
    models: Array<{ name: string }>;
    onSelectModel?: (providerId: string) => void;
    onReasoningEffortChange?: (effort: "high") => void;
  }) => (
    <span>
      模型 {models.map((model) => model.name).join(" / ") || "推理模型"}
      <button onClick={() => onSelectModel?.("provider-2")}>切换模型</button>
      <button onClick={() => onReasoningEffortChange?.("high")}>切换推理</button>
    </span>
  ),
  ExecutionPolicy: ({
    onChange,
  }: {
    onChange?: (value: { approvalPolicy: "never"; permissionProfile: ":danger-full-access" }) => void;
  }) => (
    <button onClick={() => onChange?.({ approvalPolicy: "never", permissionProfile: ":danger-full-access" })}>
      切换权限
    </button>
  ),
}));

function fixture(status: LocalThread["status"] = "idle", segment: LocalStream["segment"] = null) {
  const thread: LocalThread = {
    id: "local",
    mode: "local",
    title: "Local",
    workspace: "/project",
    providerId: "provider",
    reasoningEffort: "medium",
    approvalPolicy: "on-request",
    permissionProfile: ":workspace",
    pluginActivations: [],
    status,
    error: null,
    turnId: status === "running" ? "turn" : null,
    updatedAt: "",
    pendingInputs: [],
    contextUsage: null,
    messages: [],
  };
  const off = vi.fn();
  const listeners = new Set<(event: DesktopEvent) => void>();
  const bridge = {
    subscribe: vi.fn((next) => {
      listeners.add(next);
      return () => {
        listeners.delete(next);
        off();
      };
    }),
    approve: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    submitRunInput: vi.fn(async () => ({ admission: "accepted", turnId: "turn" })),
    setModelBinding: vi.fn(async () => {}),
    setExecutionPolicy: vi.fn(async () => {}),
    openStream: vi.fn(async () => ({ thread, segment })),
  } as unknown as DesktopBridge;
  const transport = new LocalChatTransport(bridge, thread.id);
  return { thread, bridge, transport, off, emit: (event: DesktopEvent) => listeners.forEach((next) => next(event)) };
}

beforeEach(() => {
  promptApi.clear.mockClear();
  promptApi.setValue.mockClear();
  sessionViewApi.chat = null;
  sessionViewApi.runActive = false;
});

test("keeps the transcript pending while the native runtime is active", () => {
  const f = fixture("running");
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} />);

  expect(sessionViewApi.runActive).toBe(true);
});

test("shows each model reconnect attempt and clears the hint after recovery", async () => {
  const f = fixture("running", {
    id: "segment",
    messages: [],
    chunks: [
      {
        type: "data-model-retry",
        data: { state: "retrying", attempt: 1, maxAttempts: 3, reason: "connection_reset" },
        transient: true,
      },
    ],
    done: false,
  });
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} />);

  act(() => {
    void sessionViewApi.chat?.resumeStream();
  });
  expect((await screen.findByRole("status")).textContent).toContain("模型连接被重置，正在重连（1/3）");

  act(() => {
    f.emit({
      type: "stream",
      threadId: "local",
      segmentId: "segment",
      index: 1,
      chunk: {
        type: "data-model-retry",
        data: { state: "recovered", attempt: 1, maxAttempts: 3, reason: "connection_reset" },
        transient: true,
      },
    });
    f.emit({ type: "stream", threadId: "local", segmentId: "segment", index: 2, chunk: null });
  });
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
});

test("shows automatic context compaction until the shared runtime completes it", async () => {
  const f = fixture("running", {
    id: "segment",
    messages: [],
    chunks: [
      {
        type: "data-context-compaction",
        data: { state: "started", phase: "history" },
        transient: true,
      },
    ],
    done: false,
  });
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} />);

  act(() => {
    void sessionViewApi.chat?.resumeStream();
  });
  expect((await screen.findByRole("status")).textContent).toContain("正在压缩较早的会话历史");

  act(() => {
    f.emit({
      type: "stream",
      threadId: "local",
      segmentId: "segment",
      index: 1,
      chunk: {
        type: "data-context-compaction",
        data: { state: "completed", phase: "history" },
        transient: true,
      },
    });
  });
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
});

test("updates context usage from each live model-step snapshot", async () => {
  const f = fixture("running", {
    id: "segment",
    messages: [],
    chunks: [
      {
        type: "data-context-usage",
        data: {
          contextWindow: 100_000,
          autoCompactAt: 90_000,
          usedTokens: 40_000,
          estimated: true,
          compacted: false,
          categories: [{ id: "conversation", tokens: 40_000 }],
        },
        transient: true,
      },
    ],
    done: false,
  });
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} />);

  act(() => {
    void sessionViewApi.chat?.resumeStream();
  });
  expect(await screen.findByText("40000:estimated")).toBeTruthy();

  act(() => {
    f.emit({
      type: "stream",
      threadId: "local",
      segmentId: "segment",
      index: 1,
      chunk: {
        type: "data-context-usage",
        data: {
          contextWindow: 100_000,
          autoCompactAt: 90_000,
          usedTokens: 42_000,
          estimated: false,
          compacted: false,
          categories: [{ id: "conversation", tokens: 42_000 }],
        },
        transient: true,
      },
    });
  });
  expect(await screen.findByText("42000:confirmed")).toBeTruthy();
});

test("uses the shared session composer and sends native local message parts", async () => {
  const f = fixture();
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} />);

  expect(screen.getByText("发送消息或创建任务…")).toBeTruthy();
  expect(screen.getByTestId("local-context-usage")).toBeTruthy();
  expect(await screen.findByText("模型 baymax")).toBeTruthy();
  fireEvent.click(screen.getByText("发送测试"));

  await waitFor(() =>
    expect(f.bridge.send).toHaveBeenCalledWith("local", [{ type: "text", text: "创建文件" }], expect.any(String)),
  );
  expect(promptApi.clear).toHaveBeenCalledOnce();
});

test("running input is admitted as a follow-up without creating another turn", async () => {
  const f = fixture("running");
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} />);

  expect(screen.getByText("补充当前任务…")).toBeTruthy();
  expect(screen.getByTestId("composer-loading").textContent).toBe("true");
  expect(screen.getByTestId("submit-while-loading").textContent).toBe("true");
  fireEvent.click(screen.getByText("发送测试"));

  await waitFor(() =>
    expect(f.bridge.submitRunInput).toHaveBeenCalledWith("local", "turn", "创建文件", expect.any(String), "follow-up"),
  );
  expect(f.bridge.send).not.toHaveBeenCalled();
});

test("updates the local model, reasoning and execution policy through the bridge", async () => {
  const f = fixture();
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} />);
  await screen.findByText(/模型 baymax/);

  fireEvent.click(screen.getByText("切换模型"));
  await waitFor(() => expect(f.bridge.setModelBinding).toHaveBeenCalledWith("local", "provider-2", "medium"));
  fireEvent.click(screen.getByText("切换推理"));
  await waitFor(() => expect(f.bridge.setModelBinding).toHaveBeenCalledWith("local", "provider-2", "high"));
  fireEvent.click(screen.getByText("切换权限"));
  await waitFor(() =>
    expect(f.bridge.setExecutionPolicy).toHaveBeenCalledWith("local", "never", ":danger-full-access"),
  );
});

test("shared tool approval reloads the local journal", async () => {
  const f = fixture("waiting");
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} />);
  fireEvent.click(screen.getByText("共享授权"));
  await waitFor(() => expect(f.bridge.approve).toHaveBeenCalledWith("local", "approval", true));
  await waitFor(() => expect(f.bridge.openStream).toHaveBeenCalledWith("local"));
});

test("runtime recovery reloads persisted state and navigation only detaches", async () => {
  const f = fixture();
  const view = render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} />);

  act(() => f.emit({ type: "runtime-error", message: "正在恢复" }));
  expect(screen.getByRole("alert").textContent).toContain("正在恢复");
  act(() => f.emit({ type: "runtime-ready" }));
  await waitFor(() => expect(f.bridge.openStream).toHaveBeenCalledWith("local"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

  view.unmount();
  expect(f.off).toHaveBeenCalled();
  expect(f.bridge.stop).not.toHaveBeenCalled();
});
