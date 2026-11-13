import type { DesktopBridge, LocalThread } from "@repo/runtime/desktop";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";

import { LocalMessages } from "./LocalMessages";
import { LocalChatTransport } from "./transport";

vi.mock("@repo/ai-elements/conversation", () => ({
  ChatStream: ({ onToolApproval }: { onToolApproval: (id: string, approved: boolean) => void }) => (
    <button onClick={() => onToolApproval("approval", true)}>共享授权</button>
  ),
  ChatPrompt: ({ onStop, footerRender }: { onStop: () => void; footerRender: () => ReactNode }) => (
    <div>
      {footerRender()}
      <button onClick={onStop}>停止测试</button>
    </div>
  ),
  ExecutionLocation: () => <span>本地电脑</span>,
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
    messages: [],
  };
  const off = vi.fn();
  const bridge = {
    subscribe: vi.fn(() => off),
    approve: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    openStream: vi.fn(async () => ({ thread, segment: null })),
  } as unknown as DesktopBridge;
  const transport = new LocalChatTransport(bridge, thread.id);
  return { thread, bridge, transport, off };
}
test("shared tool approval resumes the local journal without invoking cloud transport", async () => {
  const f = fixture();
  render(<LocalMessages bridge={f.bridge} initial={f.thread} transport={f.transport} />);
  fireEvent.click(screen.getByText("共享授权"));
  await waitFor(() => expect(f.bridge.approve).toHaveBeenCalledWith("local", "approval", true));
  await waitFor(() => expect(f.bridge.openStream).toHaveBeenCalledWith("local"));
});
test("navigation detaches the local subscriber; only explicit Stop stops the runtime", async () => {
  const f = fixture();
  const view = render(<LocalMessages bridge={f.bridge} initial={f.thread} transport={f.transport} />);
  view.unmount();
  expect(f.off).toHaveBeenCalled();
  expect(f.bridge.stop).not.toHaveBeenCalled();
  render(<LocalMessages bridge={f.bridge} initial={f.thread} transport={f.transport} />);
  fireEvent.click(screen.getByText("停止测试"));
  await waitFor(() => expect(f.bridge.stop).toHaveBeenCalledWith("local"));
});
