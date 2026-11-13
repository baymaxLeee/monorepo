import type { PromptInputRef, PromptInputValue } from "@repo/ai-elements/prompt-input";
import type { DesktopBridge, LocalThread } from "@repo/runtime/desktop";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    onStop,
    onSubmit,
    footerRender,
    pendingInputs = [],
    submitWhileLoading,
  }: {
    ref: Ref<PromptInputRef>;
    placeholder: string;
    onStop: () => void;
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
        <span data-testid="submit-while-loading">{String(submitWhileLoading)}</span>
        {pendingInputs.map((input) => (
          <span key={input.id}>{input.text}</span>
        ))}
        {footerRender()}
        <button onClick={onStop}>停止测试</button>
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
}));
function fixture() {
  const thread: LocalThread = {
    id: "local",
    mode: "local",
    title: "Local",
    workspace: "/project",
    agentId: null,
    status: "waiting",
    error: null,
    turnId: null,
    updatedAt: "",
    pendingInputs: [],
    messages: [],
  };
  const off = vi.fn();
  const bridge = {
    subscribe: vi.fn(() => off),
    approve: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    steer: vi.fn(async () => ({ admission: "accepted", turnId: "turn" })),
    openStream: vi.fn(async () => ({ thread, segment: null })),
  } as unknown as DesktopBridge;
  const transport = new LocalChatTransport(bridge, thread.id);
  return { thread, bridge, transport, off };
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
  fireEvent.click(screen.getByText("发送测试"));

  expect(promptApi.clear).toHaveBeenCalledOnce();
  await waitFor(() => expect(f.bridge.send).toHaveBeenCalledWith("local", "创建文件", expect.any(String)));
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
  f.bridge.steer = vi.fn(
    () =>
      new Promise<{ admission: "accepted"; turnId: string }>((resolve) => {
        admit = resolve;
      }),
  );
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} onOpenFiles={vi.fn()} />);

  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() => expect(f.bridge.steer).toHaveBeenCalledOnce());
  expect(promptApi.clear).not.toHaveBeenCalled();
  expect(screen.getByTestId("submit-while-loading").textContent).toBe("true");
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
test("navigation detaches the local subscriber; only explicit Stop stops the runtime", async () => {
  const f = fixture();
  const view = render(
    <LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} onOpenFiles={vi.fn()} />,
  );
  view.unmount();
  expect(f.off).toHaveBeenCalled();
  expect(f.bridge.stop).not.toHaveBeenCalled();
  render(<LocalSession bridge={f.bridge} initial={f.thread} transport={f.transport} onOpenFiles={vi.fn()} />);
  fireEvent.click(screen.getByText("停止测试"));
  await waitFor(() => expect(f.bridge.stop).toHaveBeenCalledWith("local"));
});
