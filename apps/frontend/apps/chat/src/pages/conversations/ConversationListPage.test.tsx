import type * as ConversationUI from "@repo/ai-elements/conversation";
import type { PromptInputValue } from "@repo/ai-elements/prompt-input";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as Router from "react-router-dom";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

import { ConversationListPage } from "./ConversationListPage";

vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = vi.fn();

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  local: vi.fn(),
  list: vi.fn(),
  selectWorkspace: vi.fn(),
  send: vi.fn(),
  navigate: vi.fn(),
  upload: vi.fn(),
  providers: vi.fn(),
  plugins: vi.fn(),
  desktop: true,
}));
vi.mock("@repo/api/chat", () => ({
  createConversation: mocks.create,
}));
vi.mock("@repo/api/admin", () => ({ listAgentPluginOptions: mocks.plugins, listProviders: mocks.providers }));
vi.mock("@repo/ai-elements/conversation/lib/upload-conversation-files", () => ({
  uploadConversationFiles: mocks.upload,
}));
vi.mock("@repo/runtime/desktop", () => ({
  getDesktopBridge: () =>
    mocks.desktop
      ? {
          createThread: mocks.local,
          listThreads: mocks.list,
          selectWorkspace: mocks.selectWorkspace,
          send: mocks.send,
        }
      : null,
}));
vi.mock("react-router-dom", async (original) => ({
  ...(await original<typeof Router>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@repo/ai-elements/conversation", async (original) => ({
  ...(await original<typeof ConversationUI>()),
  ChatPrompt: ({
    toolbarRender,
    footerRender,
    onSubmit,
    maxFiles,
  }: {
    toolbarRender?: () => ReactNode;
    footerRender?: () => ReactNode;
    onSubmit: (value: PromptInputValue) => void;
    maxFiles?: number;
  }) => (
    <div>
      <span data-testid="max-files">{maxFiles}</span>
      {toolbarRender?.()}
      {footerRender?.()}
      <button
        onClick={() => onSubmit({ text: "hello", segments: [{ type: "text", text: "hello" }], tokens: [], files: {} })}
      >
        发送测试
      </button>
      <button
        onClick={() => {
          const file = new File(["content"], "brief.md", { type: "text/markdown" });
          const token = { id: "file-token", kind: "file", label: file.name, mime: file.type };
          onSubmit({
            text: "[[file-token]]",
            segments: [{ type: "token", token }],
            tokens: [token],
            files: { [token.id]: file },
          });
        }}
      >
        发送附件测试
      </button>
    </div>
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.desktop = true;
  mocks.create.mockResolvedValue({ id: "cloud" });
  mocks.local.mockResolvedValue({ id: "local" });
  mocks.list.mockResolvedValue([{ workspace: "/projects/existing" }]);
  mocks.selectWorkspace.mockResolvedValue("/projects/new-project");
  mocks.send.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue({
    documents: [
      {
        client_ref: "file-token",
        document: { id: "document", asset_id: "asset", source_revision_id: "revision" },
      },
    ],
    failed: [],
  });
  mocks.providers.mockResolvedValue([
    {
      id: "cloud-model",
      name: "Cloud Model",
      model: "ark-model",
      provider_kind: "chat",
      is_enabled: true,
      is_default: true,
    },
  ]);
  mocks.plugins.mockResolvedValue([]);
});

async function selectExecutionLocation(name: "云端" | "本地电脑") {
  fireEvent.click(screen.getByRole("combobox", { name: "执行位置" }));
  fireEvent.pointerDown(await screen.findByRole("option", { name }), { pointerType: "mouse" });
  fireEvent.click(screen.getByRole("option", { name }));
}

test("new cloud conversation renders session controls and submits their request shape", async () => {
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  await selectExecutionLocation("云端");
  expect(screen.getByTestId("max-files").textContent).toBe("8");
  expect(await screen.findByText("Cloud Model")).toBeTruthy();
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/platform/chat/conversations/cloud",
      expect.objectContaining({
        state: expect.objectContaining({
          externalRequest: expect.objectContaining({
            parts: [{ type: "text", text: "hello" }],
          }),
        }),
      }),
    ),
  );
  expect(mocks.create).toHaveBeenCalledWith({
    request_id: expect.any(String),
    provider_id: "cloud-model",
    reasoning_effort: "medium",
    plugin_selections: [],
  });
  expect(mocks.local).not.toHaveBeenCalled();
});

test("new cloud conversation uploads attachments before handing the first message to the session", async () => {
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  await selectExecutionLocation("云端");

  fireEvent.click(screen.getByText("发送附件测试"));

  await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/platform/chat/conversations/cloud",
      expect.objectContaining({
        state: expect.objectContaining({
          externalRequest: expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({ type: "file", filename: "brief.md" }),
              { type: "text", text: "请阅读并处理我附加的文件。" },
            ]),
          }),
        }),
      }),
    ),
  );
});
test("Desktop defaults to this computer and creates in the selected existing project", async () => {
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  const executionLocation = screen.getByRole("combobox", { name: "执行位置" });
  expect(executionLocation.textContent).toContain("此计算机");
  expect(executionLocation.classList.contains("focus-visible:ring-1")).toBe(true);
  expect(executionLocation.classList.contains("focus-visible:ring-3")).toBe(false);
  expect(screen.getByTestId("max-files").textContent).toBe("0");
  expect(await screen.findByText("existing")).toBeTruthy();
  const projectSelector = screen.getByRole("button", { name: "选择项目" });
  expect(projectSelector.classList.contains("focus-visible:ring-1")).toBe(true);
  expect(projectSelector.closest('[data-slot="input-group-addon"]')?.classList.contains("border-b")).toBe(false);
  expect(screen.queryByRole("button", { name: "查看上下文用量" })).toBeNull();
  expect(await screen.findByText("Cloud Model")).toBeTruthy();
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() =>
    expect(mocks.local).toHaveBeenCalledWith(
      "/projects/existing",
      "cloud-model",
      "medium",
      "on-request",
      ":workspace",
      [],
    ),
  );
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("local", "hello", expect.any(String)));
  expect(mocks.create).not.toHaveBeenCalled();
});

test("new project selection happens before send and supplies the authorized workspace", async () => {
  mocks.list.mockResolvedValue([]);
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
  fireEvent.click(await screen.findByText("新建项目"));
  await waitFor(() => expect(mocks.selectWorkspace).toHaveBeenCalledOnce());
  expect(await screen.findByText("new-project")).toBeTruthy();
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() =>
    expect(mocks.local).toHaveBeenCalledWith(
      "/projects/new-project",
      "cloud-model",
      "medium",
      "on-request",
      ":workspace",
      [],
    ),
  );
  expect(mocks.selectWorkspace.mock.invocationCallOrder[0]).toBeLessThan(mocks.local.mock.invocationCallOrder[0]);
});

test("cancelling project selection leaves send blocked without reopening the picker", async () => {
  mocks.list.mockResolvedValue([]);
  mocks.selectWorkspace.mockResolvedValue(null);
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
  fireEvent.click(await screen.findByText("新建项目"));
  await waitFor(() => expect(mocks.selectWorkspace).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByText("发送测试"));
  expect((await screen.findByRole("alert")).textContent).toContain("请先选择项目");
  expect(mocks.selectWorkspace).toHaveBeenCalledTimes(1);
  expect(mocks.local).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

test("Web omits execution selection and submits to cloud", async () => {
  mocks.desktop = false;
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("combobox", { name: "执行位置" })).toBeNull();
  expect(screen.queryByText("使用桌面应用可选择本地电脑")).toBeNull();
  expect(await screen.findByText("Cloud Model")).toBeTruthy();
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(mocks.local).not.toHaveBeenCalled();
});

test("an installed default plugin is frozen into both cloud and local conversation creation", async () => {
  mocks.plugins.mockResolvedValue([
    {
      pluginId: "knowledge@platform",
      displayName: "知识库",
      description: "Search workspace knowledge.",
      selectedByDefault: true,
      requiresBindings: false,
    },
  ]);
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText("插件 1")).toBeTruthy();
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() =>
    expect(mocks.local).toHaveBeenCalledWith(
      "/projects/existing",
      "cloud-model",
      "medium",
      "on-request",
      ":workspace",
      [{ pluginId: "knowledge@platform" }],
    ),
  );

  await selectExecutionLocation("云端");
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() =>
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ plugin_selections: [{ plugin_id: "knowledge@platform" }] }),
    ),
  );
});

test("repeated submit while creating cannot create duplicate conversations", async () => {
  mocks.desktop = false;
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
  expect(await screen.findByText("Cloud Model")).toBeTruthy();
  fireEvent.click(screen.getByText("发送测试"));
  fireEvent.click(screen.getByText("发送测试"));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  resolve({ id: "cloud" });
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
});
