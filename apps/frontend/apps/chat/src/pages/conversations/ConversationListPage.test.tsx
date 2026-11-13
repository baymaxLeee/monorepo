import type * as ConversationUI from "@repo/ai-elements/conversation";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as Router from "react-router-dom";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

import { ConversationListPage } from "./ConversationListPage";
const mocks = vi.hoisted(() => ({ create: vi.fn(), local: vi.fn(), send: vi.fn(), navigate: vi.fn(), desktop: true }));
vi.mock("@repo/api/chat", () => ({ createConversation: mocks.create }));
vi.mock("@repo/runtime/desktop", () => ({
  getDesktopBridge: () => (mocks.desktop ? { createThread: mocks.local, send: mocks.send } : null),
}));
vi.mock("react-router-dom", async (original) => ({
  ...(await original<typeof Router>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@repo/ai-elements/conversation", async (original) => ({
  ...(await original<typeof ConversationUI>()),
  ChatPrompt: ({
    footerRender,
    onSubmit,
  }: {
    footerRender?: () => ReactNode;
    onSubmit: (value: { text: string; tokens: never[] }) => void;
  }) => (
    <div>
      {footerRender?.()}
      <button onClick={() => onSubmit({ text: "hello", tokens: [] })}>发送测试</button>
    </div>
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.desktop = true;
  mocks.create.mockResolvedValue({ id: "cloud" });
  mocks.local.mockResolvedValue({ id: "local" });
  mocks.send.mockResolvedValue(undefined);
});
test("new cloud conversation submits through the shared chat route", async () => {
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/platform/chat/conversations/cloud",
      expect.objectContaining({
        state: expect.objectContaining({ externalRequest: expect.objectContaining({ text: "hello" }) }),
      }),
    ),
  );
  expect(mocks.local).not.toHaveBeenCalled();
});
test("local selection creates only a local thread and sends locally", async () => {
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("combobox", { name: "执行位置" }));
  fireEvent.pointerDown(await screen.findByRole("option", { name: "本地电脑" }), { pointerType: "mouse" });
  fireEvent.click(screen.getByRole("option", { name: "本地电脑" }));
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("local", "hello", expect.any(String)));
  expect(mocks.create).not.toHaveBeenCalled();
});
test("cancelling the directory chooser does not create a cloud conversation or send", async () => {
  mocks.local.mockResolvedValue(null);
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("combobox", { name: "执行位置" }));
  fireEvent.pointerDown(await screen.findByRole("option", { name: "本地电脑" }), { pointerType: "mouse" });
  fireEvent.click(screen.getByRole("option", { name: "本地电脑" }));
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() => expect(mocks.local).toHaveBeenCalled());
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

test("Web disables local execution without a desktop bridge", async () => {
  mocks.desktop = false;
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("combobox", { name: "执行位置" }));
  expect((await screen.findByRole("option", { name: "本地电脑" })).getAttribute("aria-disabled")).toBe("true");
});

test("repeated submit while creating cannot create duplicate conversations", async () => {
  let resolve: (value: { id: string }) => void = () => {};
  mocks.create.mockReturnValue(
    new Promise<{ id: string }>((done) => {
      resolve = done;
    }),
  );
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("发送测试"));
  fireEvent.click(screen.getByText("发送测试"));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  resolve({ id: "cloud" });
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
});
