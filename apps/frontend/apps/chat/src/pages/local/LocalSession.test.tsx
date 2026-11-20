import type { PromptInputRef, PromptInputValue } from "@repo/ai-elements/prompt-input";
import type { DesktopBridge, DesktopEvent, LocalThread } from "@repo/runtime/desktop";
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

vi.mock("@repo/ai-elements", () => ({ ContextUsage: () => <span data-testid="local-context-usage" /> }));
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
vi.mock("@repo/ai-elements/conversation", () => ({
  ConversationSessionView: ({
    composer,
    issue,
    onToolApproval,
  }: {
    composer: ReactNode;
    issue: ReactNode;
    onToolApproval: (id: string, approved: boolean) => void;
  }) => (
    <div>
      {issue}
      {composer}
      <button onClick={() => onToolApproval("approval", true)}>共享授权</button>
    </div>
  ),
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

function fixture(status: LocalThread["status"] = "idle") {
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
    setModelBinding: vi.fn(async () => {}),
    setExecutionPolicy: vi.fn(async () => {}),
    openStream: vi.fn(async () => ({ thread, segment: null })),
  } as unknown as DesktopBridge;
  const transport = new LocalChatTransport(bridge, thread.id);
  return { thread, bridge, transport, off, emit: (event: DesktopEvent) => listener?.(event) };
}

beforeEach(() => {
  promptApi.clear.mockClear();
  promptApi.setValue.mockClear();
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
