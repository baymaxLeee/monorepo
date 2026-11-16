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
    {
      id: "local-two",
      mode: "local",
      title: "创建 Demo",
      workspace: "/projects/magico",
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

test("supports both project-group and per-project collapsing", async () => {
  render(
    <MemoryRouter>
      <LocalConversationHistory onSelect={vi.fn()} />
    </MemoryRouter>,
  );

  const toggle = await screen.findByRole("button", { name: "monorepo" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("优化 Electron 配置设计")).toBeTruthy();
  expect(screen.getByText("创建 Demo")).toBeTruthy();

  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("优化 Electron 配置设计")).toBeNull();
  expect(screen.getByText("创建 Demo")).toBeTruthy();

  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("优化 Electron 配置设计")).toBeTruthy();

  const groupToggle = screen.getByRole("button", { name: "项目" });
  fireEvent.click(groupToggle);
  expect(groupToggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: "monorepo" })).toBeNull();

  fireEvent.click(groupToggle);
  expect(groupToggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: "monorepo" })).toBeTruthy();
});
