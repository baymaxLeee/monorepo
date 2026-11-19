import type { PromptInputRef, PromptInputValue } from "@repo/ai-elements/prompt-input";
import type { DesktopBridge, DesktopEvent, LocalThread } from "@repo/runtime/desktop";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { expect, test, vi } from "vitest";

import { LocalSession } from "./LocalSession";
import { LocalChatTransport } from "./transport";

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
vi.mock("@repo/ai-elements", () => ({
  ContextUsage: () => <span data-testid="local-context-usage" />,
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
vi.mock("@repo/ai-elements/conversation", () => ({
  ApprovalMode: ({ value }: { value: string }) => <span>授权 {value}</span>,
  ConversationSessionView: ({
    composer,
    issue,
    onToolApproval,
    onOpenWorkspaceFile,
  }: {
    composer: ReactNode;
    issue: ReactNode;
    onToolApproval: (id: string, approved: boolean) => void;
    onOpenWorkspaceFile?: (path: string) => void;
  }) => (
    <div>
      {issue}
      {composer}
      <button onClick={() => onToolApproval("approval", true)}>共享授权</button>
      {onOpenWorkspaceFile ? (
        <button onClick={() => onOpenWorkspaceFile("output/report.html")}>打开产物文件</button>
      ) : null}
    </div>
  ),
  ChatPrompt: ({
    ref,
    placeholder,
    onStop,
    loading,
    disabled,
    onSubmit,
    footerRender,
    pendingInputs = [],
    submitWhileLoading,
  }: {
    ref: Ref<PromptInputRef>;
    placeholder: string;
    onStop: () => void;
    loading?: boolean;
    disabled?: boolean;
    onSubmit: (value: PromptInputValue) => void;
    footerRender: () => ReactNode;
    pendingInputs?: Array<{ id: string; text: string }>;
    submitWhileLoading?: boolean;
  }) => {
    const api = promptApi as unknown as PromptInputRef;
    if (typeof ref === "function") ref(api);
    else if (ref) ref.current = api;
    return (
      <div>
        <span>{placeholder}</span>
        <span data-testid="composer-loading">{String(Boolean(loading))}</span>
        <span data-testid="composer-disabled">{String(Boolean(disabled))}</span>
        <span data-testid="submit-while-loading">{String(Boolean(submitWhileLoading))}</span>
        {pendingInputs.map((input) => (
          <span key={input.id}>{input.text}</span>
        ))}
        {footerRender()}
        {onStop ? <button onClick={onStop}>停止测试</button> : null}
        <button
          onClick={() =>
            onSubmit({ text: "创建文件", segments: [{ type: "text", text: "创建文件" }], tokens: [], files: {} })
          }
        >
          发送测试
        </button>
      </div>
    );
  },
  ChatComposerControls: ({ models }: { models: Array<{ name: string }> }) => (
    <span>模型 {models[0]?.name ?? "推理模型"}</span>
  ),
}));
function fixture() {
  const thread: LocalThread = {
    id: "local",
    mode: "local",
    title: "Local",
    workspace: "/project",
    providerId: "provider",
    reasoningEffort: "medium",
    approvalMode: "auto",
    status: "waiting",
    error: null,
    turnId: null,
    updatedAt: "",
    pendingInputs: [],
    messages: [],
  };
  const off = vi.fn();
  let listener: ((event: DesktopEvent) => void) | null = null;
  const bridge = {
    subscribe: vi.fn((next) => {
      listener = next;
      return off;
    }),
    approve: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    submitRunInput: vi.fn(async () => ({ admission: "accepted", turnId: "turn" })),
    openStream: vi.fn(async () => ({ thread, segment: null })),
  } as unknown as DesktopBridge;
  const transport = new LocalChatTransport(bridge, thread.id);
  return { thread, bridge, transport, off, emit: (event: DesktopEvent) => listener?.(event) };
}

test("clears a submitted local prompt immediately and uses the task-oriented placeholder", async () => {
  promptApi.clear.mockClear();
  promptApi.setValue.mockClear();
  const f = fixture();
  f.thread.status = "idle";
  f.bridge.send = vi.fn(() => new Promise<void>(() => {}));
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} onOpenFiles={vi.fn()} />);

  expect(screen.getByText("发送消息或创建任务…")).toBeTruthy();
  expect(screen.queryByText("本地电脑")).toBeNull();
  await screen.findByText(/模型 baymax/);
  expect(screen.queryByText("project")).toBeNull();
  expect(screen.queryByRole("button", { name: "查看本地文件" })).toBeNull();
  expect(screen.getByRole("button", { name: "浏览工作区文件" })).toBeTruthy();
  expect(screen.getByTestId("local-context-usage")).toBeTruthy();
  fireEvent.click(screen.getByText("发送测试"));

  expect(promptApi.clear).toHaveBeenCalledOnce();
  await waitFor(() => expect(f.bridge.send).toHaveBeenCalledWith("local", "创建文件", expect.any(String)));
});

test("keeps the local composer visually enabled while a turn is running", () => {
  const f = fixture();
  f.thread.status = "running";
  f.thread.turnId = "turn";
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} onOpenFiles={vi.fn()} />);

  expect(screen.getByTestId("composer-loading").textContent).toBe("false");
  expect(screen.getByTestId("composer-disabled").textContent).toBe("false");
  expect(screen.queryByText("停止测试")).toBeNull();
});

test("restores the submitted local prompt when sending fails", async () => {
  promptApi.clear.mockClear();
  promptApi.setValue.mockClear();
  const f = fixture();
  f.thread.status = "idle";
  f.bridge.send = vi.fn(async () => {
    throw new Error("发送失败");
  });
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} onOpenFiles={vi.fn()} />);

  fireEvent.click(screen.getByText("发送测试"));

  await waitFor(() =>
    expect(promptApi.setValue).toHaveBeenCalledWith({
      text: "创建文件",
      segments: [{ type: "text", text: "创建文件" }],
      tokens: [],
      files: {},
    }),
  );
  expect(screen.getByRole("alert").textContent).toContain("发送失败");
});
test("running input stays editable until Desktop admits it and then appears above the editor", async () => {
  promptApi.clear.mockClear();
  let admit: (value: { admission: "accepted"; turnId: string }) => void = () => {};
  const f = fixture();
  f.thread.status = "running";
  f.thread.turnId = "turn";
  f.bridge.submitRunInput = vi.fn(
    () =>
      new Promise<{ admission: "accepted"; turnId: string }>((resolve) => {
        admit = resolve;
      }),
  );
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} onOpenFiles={vi.fn()} />);

  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() => expect(f.bridge.submitRunInput).toHaveBeenCalledOnce());
  expect(f.bridge.submitRunInput).toHaveBeenCalledWith("local", "turn", "创建文件", expect.any(String), "follow-up");
  expect(promptApi.clear).not.toHaveBeenCalled();
  expect(screen.getByTestId("submit-while-loading").textContent).toBe("false");
  admit({ admission: "accepted", turnId: "turn" });
  await waitFor(() => expect(promptApi.clear).toHaveBeenCalledOnce());
});
test("shared tool approval resumes the local journal without invoking cloud transport", async () => {
  const f = fixture();
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} onOpenFiles={vi.fn()} />);
  fireEvent.click(screen.getByText("共享授权"));
  await waitFor(() => expect(f.bridge.approve).toHaveBeenCalledWith("local", "approval", true));
  await waitFor(() => expect(f.bridge.openStream).toHaveBeenCalledWith("local"));
});
test("forwards local data-file clicks to the workspace file opener", () => {
  const f = fixture();
  const onOpenFile = vi.fn();
  render(
    <LocalSession
      bridge={f.bridge}
      initial={f.thread}
      transport={f.transport}
      onOpenFiles={vi.fn()}
      onOpenFile={onOpenFile}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "打开产物文件" }));

  expect(onOpenFile).toHaveBeenCalledWith("output/report.html");
});
test("navigation detaches the local subscriber without stopping the runtime", () => {
  const f = fixture();
  const view = render(
    <LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} onOpenFiles={vi.fn()} />,
  );
  view.unmount();
  expect(f.off).toHaveBeenCalled();
  expect(f.bridge.stop).not.toHaveBeenCalled();
});

test("reloads the persisted journal when the native runtime recovers", async () => {
  const f = fixture();
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} onOpenFiles={vi.fn()} />);

  act(() => f.emit({ type: "runtime-error", message: "正在恢复" }));
  expect(screen.getByRole("alert").textContent).toContain("正在恢复");
  act(() => f.emit({ type: "runtime-ready" }));

  await waitFor(() => expect(f.bridge.openStream).toHaveBeenCalledWith("local"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
