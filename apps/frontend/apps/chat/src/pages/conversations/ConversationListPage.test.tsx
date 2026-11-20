import type * as ConversationUI from "@repo/ai-elements/conversation";
import type { PromptInputValue } from "@repo/ai-elements/prompt-input";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as Router from "react-router-dom";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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
  navigate: vi.fn(),
  upload: vi.fn(),
  providers: vi.fn(),
  plugins: vi.fn(),
}));
vi.mock("@repo/api/chat", () => ({ createConversation: mocks.create }));
vi.mock("@repo/api/admin", () => ({ listAgentPluginOptions: mocks.plugins, listProviders: mocks.providers }));
vi.mock("@repo/ai-elements/conversation/lib/upload-conversation-files", () => ({
  uploadConversationFiles: mocks.upload,
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
    maxFiles,
    disabled,
    loading,
  }: {
    footerRender?: () => React.ReactNode;
    onSubmit: (value: PromptInputValue) => void;
    maxFiles?: number;
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <div data-testid="new-composer" data-disabled={String(Boolean(disabled))} data-loading={String(Boolean(loading))}>
      <span data-testid="max-files">{maxFiles}</span>
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
  mocks.create.mockResolvedValue({ id: "cloud" });
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
afterEach(() => {
  Reflect.deleteProperty(globalThis, "desktop");
});

test("new conversation renders the shared cloud composer and submits its request shape", async () => {
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("combobox", { name: "执行位置" })).toBeNull();
  expect(screen.getByTestId("max-files").textContent).toBe("8");
  expect(await screen.findByText("Cloud Model")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "授权策略" })).toBeTruthy();
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/platform/chat/conversations/cloud",
      expect.objectContaining({
        state: expect.objectContaining({
          externalRequest: expect.objectContaining({ parts: [{ type: "text", text: "hello" }] }),
        }),
      }),
    ),
  );
  expect(mocks.create).toHaveBeenCalledWith({
    request_id: expect.any(String),
    provider_id: "cloud-model",
    reasoning_effort: "medium",
    approval_policy: "on-request",
    permission_profile: ":workspace",
    plugin_selections: [],
  });
});

test("Desktop capability does not add product UI or change cloud creation", async () => {
  Object.defineProperty(globalThis, "desktop", { configurable: true, value: { version: 5 } });
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("combobox", { name: "执行位置" })).toBeNull();
  expect(screen.queryByText("本地电脑")).toBeNull();
  expect(await screen.findByText("Cloud Model")).toBeTruthy();
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(mocks.navigate).toHaveBeenCalledWith("/platform/chat/conversations/cloud", expect.any(Object));
});

test("new conversation uploads attachments before handing the first message to the session", async () => {
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  await screen.findByText("Cloud Model");
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

test("new conversation keeps the editor enabled while creation is pending", async () => {
  let finishCreate!: (value: { id: string }) => void;
  mocks.create.mockReturnValue(
    new Promise((resolve) => {
      finishCreate = resolve;
    }),
  );
  render(
    <MemoryRouter>
      <ConversationListPage />
    </MemoryRouter>,
  );
  await screen.findByText("Cloud Model");
  fireEvent.click(screen.getByText("发送测试"));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(screen.getByTestId("new-composer").dataset).toMatchObject({ disabled: "false", loading: "true" });
  finishCreate({ id: "cloud" });
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
});

test("an installed default plugin is frozen into cloud conversation creation", async () => {
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
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ plugin_selections: [{ plugin_id: "knowledge@platform" }] }),
    ),
  );
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
  expect(await screen.findByText("Cloud Model")).toBeTruthy();
  fireEvent.click(screen.getByText("发送测试"));
  fireEvent.click(screen.getByText("发送测试"));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  resolve({ id: "cloud" });
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
});
