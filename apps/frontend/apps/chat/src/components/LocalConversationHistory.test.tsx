import type { DesktopBridge, LocalThread } from "@repo/runtime/desktop";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

import { LocalConversationHistory } from "./LocalConversationHistory";

const bridge = vi.hoisted(() => ({
  listThreads: vi.fn(),
  removeThread: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

vi.mock("@repo/runtime/desktop", () => ({
  getDesktopBridge: () => bridge as unknown as DesktopBridge,
}));

beforeEach(() => {
  bridge.listThreads.mockReset();
  bridge.removeThread.mockReset();
  bridge.subscribe.mockClear();
  bridge.listThreads.mockResolvedValue([
    {
      id: "local-one",
      mode: "local",
      title: "优化 Electron 配置设计",
      workspace: "/projects/monorepo",
      agentId: null,
      status: "idle",
      error: null,
      turnId: null,
      updatedAt: "",
      pendingInputs: [],
      messages: [],
    } satisfies LocalThread,
  ]);
});

test("collapses and expands the local project group", async () => {
  render(
    <MemoryRouter>
      <LocalConversationHistory onSelect={vi.fn()} />
    </MemoryRouter>,
  );

  const toggle = await screen.findByRole("button", { name: "项目" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("优化 Electron 配置设计")).toBeTruthy();

  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("优化 Electron 配置设计")).toBeNull();

  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("优化 Electron 配置设计")).toBeTruthy();
});
