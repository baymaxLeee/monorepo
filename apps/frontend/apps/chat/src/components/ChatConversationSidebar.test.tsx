import { SidebarProvider } from "@repo/design-system";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import { ChatConversationSidebar } from "./ChatConversationSidebar";

vi.mock("../hooks/useConversationHistory", () => ({
  useConversationHistory: () => ({
    conversations: [{ id: "0", title: "云端", updated_at: "2026-01-02T00:00:00Z" }],
    pathname: "/platform/chat/local/0",
  }),
}));

afterEach(() => vi.unstubAllGlobals());

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={["/platform/chat/local/0"]}>
      <SidebarProvider>
        <ChatConversationSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

test("desktop groups local conversations by project above recent history", async () => {
  const threads = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    title: `会话 ${i}`,
    updatedAt: i === 0 ? "2026-01-03T00:00:00Z" : "2026-01-01T00:00:00Z",
    workspace: i < 6 ? "/projects/monorepo" : "/projects/magico",
  }));
  vi.stubGlobal("desktop", {
    version: 8,
    info: async () => ({ localAvailable: true }),
    listThreads: async () => threads,
    subscribe: () => () => {},
  });
  renderSidebar();
  const project = await screen.findByRole("button", { name: "monorepo" });
  const recent = within(screen.getByRole("list", { name: "会话列表" }));
  expect(
    recent
      .getAllByRole("link")
      .slice(0, 2)
      .map((link) => link.textContent),
  ).toEqual(["会话 0", "云端"]);
  expect(recent.getByRole("link", { name: "云端" }).getAttribute("aria-current")).toBeNull();
  const group = within(screen.getByRole("region", { name: "项目 monorepo" }));
  expect(group.getByRole("button", { name: "会话 0 更多操作" })).toBeTruthy();
  expect(group.getByRole("link", { name: "会话 0" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button", { name: "magico" }).getAttribute("aria-expanded")).toBe("false");
  expect(group.queryByText("会话 6")).toBeNull();
  expect(group.queryByText("会话 5")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开显示" }));
  expect(group.getByRole("link", { name: "会话 5" }).getAttribute("href")).toBe("/platform/chat/local/5");
  fireEvent.click(project);
  expect(group.queryByText("会话 0")).toBeNull();
  expect(screen.getByRole("button", { name: "magico" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "项目" }));
  expect(screen.queryByRole("button", { name: "magico" })).toBeNull();
  expect(screen.getByText("最近")).toBeTruthy();
});

test("web renders recent history without the desktop projects section", () => {
  renderSidebar();
  expect(screen.getByText("最近")).toBeTruthy();
  expect(screen.queryByText("项目")).toBeNull();
});

test.each([false, true])(
  "native deletion updates both views only after confirmation (confirmed=%s)",
  async (confirmed) => {
    const thread = { id: "0", title: "本地测试", workspace: "/project", updatedAt: "2026-01-03T00:00:00Z" };
    let threads = [thread];
    const removeThread = vi.fn(async () => {
      if (confirmed) threads = [];
    });
    const listThreads = vi.fn(async () => threads);
    vi.stubGlobal("desktop", {
      version: 8,
      info: async () => ({ localAvailable: true }),
      listThreads,
      removeThread,
      subscribe: () => () => {},
    });
    renderSidebar();
    const region = await screen.findByRole("region", { name: "项目 project" });
    fireEvent.click(within(region).getByRole("button", { name: "本地测试 更多操作" }));
    expect(await screen.findByRole("menuitem", { name: "导出 Markdown" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "执行轨迹" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "删除会话" }));
    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
    expect(removeThread).toHaveBeenCalledExactlyOnceWith("0");
    expect(screen.queryAllByRole("link", { name: "本地测试" })).toHaveLength(confirmed ? 0 : 2);
    expect(screen.getByRole("link", { name: "云端" })).toBeTruthy();
  },
);
